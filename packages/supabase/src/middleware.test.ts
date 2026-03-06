import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateServerClient = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => mockCreateServerClient(...args),
}));

const mockNextResponse = vi.hoisted(() => ({
  next: vi.fn().mockReturnValue({
    cookies: { set: vi.fn() },
  }),
}));
vi.mock("next/server", () => ({
  NextResponse: mockNextResponse,
}));

import { createMiddlewareClient, matchesRoute } from "./middleware";

describe("matchesRoute", () => {
  it("returns true when pathname starts with a route", () => {
    expect(matchesRoute("/auth/signin", ["/auth/signin", "/auth/signup"])).toBe(
      true,
    );
  });

  it("returns true for sub-paths", () => {
    expect(
      matchesRoute("/auth/signin/extra", ["/auth/signin", "/auth/signup"]),
    ).toBe(true);
  });

  it("returns false when pathname does not match any route", () => {
    expect(matchesRoute("/dashboard", ["/auth/signin", "/auth/signup"])).toBe(
      false,
    );
  });
});

describe("createMiddlewareClient", () => {
  beforeEach(() => {
    mockCreateServerClient.mockReturnValue({});
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-key";
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_COOKIE_DOMAIN;
  });

  it("returns null supabase when env vars are missing", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const mockRequest = { cookies: { getAll: vi.fn(), set: vi.fn() } };
    const { supabase } = createMiddlewareClient(mockRequest as never);

    expect(supabase).toBeNull();
  });

  it("creates server client with cookie handlers", () => {
    const mockRequest = { cookies: { getAll: vi.fn(), set: vi.fn() } };

    createMiddlewareClient(mockRequest as never);

    expect(mockCreateServerClient).toHaveBeenCalledWith(
      "https://test.supabase.co",
      "test-key",
      expect.objectContaining({ cookies: expect.any(Object) }),
    );
  });
});
