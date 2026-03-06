import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateServerClient = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => mockCreateServerClient(...args),
}));

const mockCookieStore = vi.hoisted(() => ({
  getAll: vi.fn().mockReturnValue([]),
  set: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieStore),
}));

import { createServerClient } from "./server";

describe("createServerClient", () => {
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

  it("throws when env vars are missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    await expect(createServerClient()).rejects.toThrow(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  });

  it("creates server client with correct URL and key", async () => {
    await createServerClient();

    expect(mockCreateServerClient).toHaveBeenCalledWith(
      "https://test.supabase.co",
      "test-key",
      expect.objectContaining({ cookies: expect.any(Object) }),
    );
  });

  it("cookie getAll delegates to cookieStore", async () => {
    await createServerClient();

    const cookieConfig = mockCreateServerClient.mock.calls[0][2];
    cookieConfig.cookies.getAll();
    expect(mockCookieStore.getAll).toHaveBeenCalled();
  });

  it("cookie setAll merges domain options when NEXT_PUBLIC_COOKIE_DOMAIN is set", async () => {
    process.env.NEXT_PUBLIC_COOKIE_DOMAIN = ".example.com";

    await createServerClient();

    const cookieConfig = mockCreateServerClient.mock.calls[0][2];
    cookieConfig.cookies.setAll([
      { name: "sb-token", value: "abc", options: { path: "/" } },
    ]);
    expect(mockCookieStore.set).toHaveBeenCalledWith("sb-token", "abc", {
      path: "/",
      domain: ".example.com",
    });
  });
});
