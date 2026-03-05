import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleAuthError, validateSession } from "./auth-helpers";

// Mock supabase client
const mockGetSession = vi.fn();
const mockGetUser = vi.fn();
const mockSignOut = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: mockGetSession,
      getUser: mockGetUser,
      signOut: mockSignOut,
    },
  }),
}));

describe("validateSession", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetUser.mockReset();
    mockSignOut.mockReset();
  });

  it("returns invalid with shouldSignOut when session has error", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: new Error("corrupted"),
    });

    const result = await validateSession();

    expect(result).toEqual({
      isValid: false,
      shouldSignOut: true,
      error: "Session corrupted",
    });
  });

  it("returns invalid without shouldSignOut when no session exists", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    const result = await validateSession();

    expect(result).toEqual({
      isValid: false,
      shouldSignOut: false,
      error: "No session found",
    });
  });

  it("returns invalid with shouldSignOut when user_not_found", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "token" } },
      error: null,
    });
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { code: "user_not_found" },
    });

    const result = await validateSession();

    expect(result).toEqual({
      isValid: false,
      shouldSignOut: true,
      error: "User no longer exists",
    });
  });

  it("returns invalid with shouldSignOut on generic user error", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "token" } },
      error: null,
    });
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { code: "some_other_error" },
    });

    const result = await validateSession();

    expect(result).toEqual({
      isValid: false,
      shouldSignOut: true,
      error: "Authentication error",
    });
  });

  it("returns valid when session and user are both ok", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "token" } },
      error: null,
    });
    mockGetUser.mockResolvedValue({
      data: { user: { id: "123" } },
      error: null,
    });

    const result = await validateSession();

    expect(result).toEqual({
      isValid: true,
      shouldSignOut: false,
    });
  });

  it("returns invalid with shouldSignOut on unexpected exception", async () => {
    mockGetSession.mockRejectedValue(new Error("network failure"));

    const result = await validateSession();

    expect(result).toEqual({
      isValid: false,
      shouldSignOut: true,
      error: "Session validation failed",
    });
  });
});

describe("handleAuthError", () => {
  const mockPush = vi.fn();
  const mockRouter = { push: mockPush } as unknown as AppRouterInstance;
  const mockAddToast = vi.fn();

  beforeEach(() => {
    mockPush.mockReset();
    mockAddToast.mockReset();
    mockSignOut.mockReset();
  });

  it("signs out and redirects on user_not_found error", async () => {
    const error = { code: "user_not_found" };

    const handled = await handleAuthError(error, mockRouter, mockAddToast);

    expect(handled).toBe(true);
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith(
      "Session expired. Please sign in again.",
      "error",
    );
    expect(mockPush).toHaveBeenCalledWith("/auth/signin");
  });

  it("signs out and redirects when shouldSignOut flag is set", async () => {
    const error = { shouldSignOut: true };

    const handled = await handleAuthError(error, mockRouter, mockAddToast);

    expect(handled).toBe(true);
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith("/auth/signin");
  });

  it("works without addToast callback", async () => {
    const error = { code: "user_not_found" };

    const handled = await handleAuthError(error, mockRouter);

    expect(handled).toBe(true);
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith("/auth/signin");
  });

  it("returns false for non-auth errors", async () => {
    const error = { code: "something_else" };

    const handled = await handleAuthError(error, mockRouter, mockAddToast);

    expect(handled).toBe(false);
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
