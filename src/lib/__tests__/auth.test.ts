import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const mockSignJWTConstructor = vi.hoisted(() => vi.fn());
const mockSetProtectedHeader = vi.hoisted(() => vi.fn());
const mockSetExpirationTime = vi.hoisted(() => vi.fn());
const mockSetIssuedAt = vi.hoisted(() => vi.fn());
const mockSign = vi.hoisted(() => vi.fn());
const mockCookieSet = vi.hoisted(() => vi.fn());
const mockCookies = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
}));

vi.mock("jose", () => {
  function SignJWT(payload) {
    mockSignJWTConstructor(payload);
    this.setProtectedHeader = (h) => { mockSetProtectedHeader(h); return this; };
    this.setExpirationTime = (t) => { mockSetExpirationTime(t); return this; };
    this.setIssuedAt = () => { mockSetIssuedAt(); return this; };
    this.sign = (s) => mockSign(s);
  }
  return { SignJWT };
});

import { createSession } from "../auth";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FAKE_NOW = 1_700_000_000_000;

describe("createSession", () => {
  const mockCookieStore = { set: mockCookieSet };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FAKE_NOW);
    vi.clearAllMocks();
    mockSign.mockResolvedValue("mock-token");
    mockCookies.mockResolvedValue(mockCookieStore);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("calls SignJWT constructor with correct payload", async () => {
    await createSession("user-1", "user@example.com");
    expect(mockSignJWTConstructor).toHaveBeenCalledWith({
      userId: "user-1",
      email: "user@example.com",
      expiresAt: new Date(FAKE_NOW + SEVEN_DAYS_MS),
    });
  });

  test("sets HS256 protected header", async () => {
    await createSession("user-1", "user@example.com");
    expect(mockSetProtectedHeader).toHaveBeenCalledWith({ alg: "HS256" });
  });

  test("sets expiration time to 7d", async () => {
    await createSession("user-1", "user@example.com");
    expect(mockSetExpirationTime).toHaveBeenCalledWith("7d");
  });

  test("calls setIssuedAt", async () => {
    await createSession("user-1", "user@example.com");
    expect(mockSetIssuedAt).toHaveBeenCalled();
  });

  test("signs JWT with the encoded secret", async () => {
    await createSession("user-1", "user@example.com");
    const [secret] = mockSign.mock.calls[0];
    expect(secret?.constructor?.name).toBe("Uint8Array");
    expect(secret).toEqual(new TextEncoder().encode("development-secret-key"));
  });

  test("sets cookie with correct name and token", async () => {
    await createSession("user-1", "user@example.com");
    expect(mockCookieSet).toHaveBeenCalledWith(
      "auth-token",
      "mock-token",
      expect.any(Object)
    );
  });

  test("sets correct cookie options", async () => {
    await createSession("user-1", "user@example.com");
    const [, , options] = mockCookieSet.mock.calls[0];
    expect(options).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      expires: new Date(FAKE_NOW + SEVEN_DAYS_MS),
    });
  });

  test("propagates sign() errors", async () => {
    mockSign.mockRejectedValue(new Error("sign failed"));
    await expect(createSession("user-1", "user@example.com")).rejects.toThrow("sign failed");
  });

  test("propagates cookies().set() errors", async () => {
    mockCookieSet.mockImplementation(() => { throw new Error("cookie error"); });
    await expect(createSession("user-1", "user@example.com")).rejects.toThrow("cookie error");
  });
});
