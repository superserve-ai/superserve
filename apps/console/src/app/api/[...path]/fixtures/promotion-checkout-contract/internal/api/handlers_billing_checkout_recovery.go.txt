package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/rs/zerolog/log"

	"github.com/superserve-ai/sandbox/internal/db"
)

type billingCheckoutRecoveryRequest struct {
	Generation *time.Time `json:"checkout_generation,omitempty"`
}

type billingCheckoutRecoveryResponse struct {
	Outcome    string    `json:"outcome"`
	ID         string    `json:"id"`
	URL        string    `json:"url"`
	Generation time.Time `json:"checkout_generation"`
}

// RecoverStripeCheckoutSession only retrieves a recorded session. Keeping this
// separate from creation also makes requests fail closed on older API cells.
func (h *Handlers) RecoverStripeCheckoutSession(c *gin.Context) {
	teamID, err := customerContextTeamID(c)
	if err != nil {
		return
	}
	if !h.requireCustomerTeamPermission(c, teamID, "billing:write") {
		return
	}
	actorID, err := customerActorID(c)
	if err != nil {
		return
	}
	retriever, ok := h.Stripe.(stripeCheckoutSessionRetriever)
	if !ok || h.Pool == nil {
		respondErrorMsg(c, "service_unavailable", "Stripe checkout recovery is not configured", http.StatusServiceUnavailable)
		return
	}
	req := new(billingCheckoutRecoveryRequest)
	decoder := json.NewDecoder(http.MaxBytesReader(c.Writer, c.Request.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		respondErrorMsg(c, "bad_request", "invalid checkout recovery request", http.StatusBadRequest)
		return
	}
	if req == nil {
		respondErrorMsg(c, "bad_request", "invalid checkout recovery request", http.StatusBadRequest)
		return
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		respondErrorMsg(c, "bad_request", "invalid checkout recovery request", http.StatusBadRequest)
		return
	}
	ctx := c.Request.Context()
	exportEnabled, err := h.billingExportEnabled(ctx, teamID)
	if err != nil {
		log.Error().Err(err).Str("team_id", teamID.String()).Msg("read checkout recovery billing flag failed")
		respondError(c, ErrInternal)
		return
	}
	if !exportEnabled {
		respondErrorMsg(c, "forbidden", "Stripe checkout is unavailable in shadow billing mode", http.StatusForbidden)
		return
	}
	account, err := h.DB.GetTeamBillingCheckoutForRecovery(ctx, teamID)
	if errors.Is(err, pgx.ErrNoRows) {
		respondCheckoutRecoveryUnavailable(c)
		return
	}
	if err != nil {
		log.Error().Err(err).Str("team_id", teamID.String()).Msg("load checkout recovery generation failed")
		respondError(c, ErrInternal)
		return
	}
	if !checkoutRecoveryAccountAvailable(account, actorID, h.nowUTC()) ||
		(req.Generation != nil && !req.Generation.Equal(account.CheckoutInitializingAt.Time)) {
		respondCheckoutRecoveryUnavailable(c)
		return
	}
	evidence := db.StripeCheckoutRecoveryEvidenceAvailableParams{
		ActorID: actorID, EvidenceVersion: account.StripeCheckoutIdentityEvidenceVersion,
	}
	available, err := h.DB.StripeCheckoutRecoveryEvidenceAvailable(ctx, evidence)
	if err != nil || !available {
		log.Warn().Err(err).Str("team_id", teamID.String()).Msg("captured checkout recovery evidence unavailable")
		respondErrorMsg(c, "service_unavailable", "captured checkout identity evidence is unavailable", http.StatusServiceUnavailable)
		return
	}
	session, err := retriever.RetrieveCheckoutSession(ctx, *account.CheckoutSessionID)
	if errors.Is(err, ErrStripeCheckoutSessionNotFound) {
		respondCheckoutRecoveryUnavailable(c)
		return
	}
	if err != nil {
		log.Error().Err(err).Str("team_id", teamID.String()).Msg("retrieve Stripe checkout session failed")
		respondErrorMsg(c, "bad_gateway", "Stripe checkout recovery failed", http.StatusBadGateway)
		return
	}
	if !checkoutRecoverySessionMatches(session, account, actorID, h.nowUTC()) {
		respondCheckoutRecoveryUnavailable(c)
		return
	}
	// Provider I/O holds no database lock. Revalidate the original tuple under
	// the same gate/user/account lock order used by Checkout and its webhooks.
	tx, err := h.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		respondError(c, ErrInternal)
		return
	}
	defer tx.Rollback(ctx)
	queries := h.DB.WithTx(tx)
	if err := queries.LockStripeCheckoutRecoveryIdentity(ctx, actorID); err != nil {
		respondError(c, ErrInternal)
		return
	}
	locked, err := queries.LockTeamBillingCheckoutForRecovery(ctx, db.LockTeamBillingCheckoutForRecoveryParams{
		TeamID: teamID, ActorID: pgtype.UUID{Bytes: actorID, Valid: true},
		Generation: account.CheckoutInitializingAt, CustomerID: account.StripeCustomerID,
		SessionID: account.CheckoutSessionID, RequestKey: account.CheckoutRequestKey,
		EvidenceVersion: account.StripeCheckoutIdentityEvidenceVersion,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		respondCheckoutRecoveryUnavailable(c)
		return
	}
	if err != nil {
		log.Error().Err(err).Str("team_id", teamID.String()).Msg("lock checkout recovery generation failed")
		respondError(c, ErrInternal)
		return
	}
	if !checkoutRecoveryAccountAvailable(locked, actorID, h.nowUTC()) ||
		!checkoutRecoverySessionMatches(session, locked, actorID, h.nowUTC()) {
		respondCheckoutRecoveryUnavailable(c)
		return
	}
	available, err = queries.StripeCheckoutRecoveryEvidenceAvailable(ctx, evidence)
	if err != nil || !available {
		respondErrorMsg(c, "service_unavailable", "captured checkout identity evidence is unavailable", http.StatusServiceUnavailable)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		respondError(c, ErrInternal)
		return
	}
	c.JSON(http.StatusOK, billingCheckoutRecoveryResponse{
		Outcome: "recovered", ID: session.ID, URL: session.URL,
		Generation: account.CheckoutInitializingAt.Time.UTC(),
	})
}

func respondCheckoutRecoveryUnavailable(c *gin.Context) {
	respondErrorMsg(c, "checkout_recovery_unavailable", "no matching recoverable checkout", http.StatusConflict)
}

func checkoutRecoveryAccountAvailable(account db.TeamBillingAccount, actorID uuid.UUID, now time.Time) bool {
	if !account.StripeCheckoutActorID.Valid || uuid.UUID(account.StripeCheckoutActorID.Bytes) != actorID ||
		!account.CheckoutInitializingAt.Valid || !account.CheckoutInitializingAt.Time.Add(checkoutSessionLifetime).After(now) ||
		account.CheckoutSessionID == nil || *account.CheckoutSessionID == "" ||
		account.StripeCustomerID == nil || *account.StripeCustomerID == "" ||
		account.CheckoutCompletedAt.Valid || account.CheckoutSubscriptionID != nil {
		return false
	}
	return !billingAccountHasEstablishedSubscription(db.GetTeamBillingAccountRow{
		StripeSubscriptionID: account.StripeSubscriptionID, StripeSubscriptionStatus: account.StripeSubscriptionStatus,
	})
}

func checkoutRecoverySessionMatches(session StripeRetrievedCheckoutSession, account db.TeamBillingAccount, actorID uuid.UUID, now time.Time) bool {
	if session.ID != *account.CheckoutSessionID || session.CustomerID != *account.StripeCustomerID ||
		session.ClientReferenceID != account.TeamID.String() || session.Mode != "subscription" ||
		session.Status != "open" || session.ExpiresAt <= now.Unix() ||
		session.Metadata["activation_user_id"] != actorID.String() {
		return false
	}
	generation, err := time.Parse(time.RFC3339Nano, session.Metadata["checkout_generation"])
	if err != nil || !generation.Equal(account.CheckoutInitializingAt.Time) {
		return false
	}
	u, err := url.Parse(session.URL)
	return err == nil && u.Scheme == "https" && u.Host != "" && u.User == nil
}
