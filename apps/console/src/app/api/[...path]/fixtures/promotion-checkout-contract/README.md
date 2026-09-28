Pinned source excerpts for the promotion identity and Checkout recovery backend contract at commit
`4e3b32e6d39c4c24ff6a371a206bc0daf50ee802`.

The Checkout contract test reads these repository-owned fixtures so it runs in
an isolated Console checkout. `handlers_billing_checkout_recovery.go` is the
complete file; the other fixtures contain the asserted route, OpenAPI operation,
and SQL writer function. To update a fixture, extract the corresponding source
from that backend commit (or update the pin and contract together).
