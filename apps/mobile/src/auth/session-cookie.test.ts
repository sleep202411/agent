import { afterEach, expect, it, vi } from "vitest";
import { clearSessionCookies, persistSessionCookie } from "./session-cookie";
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
afterEach(() => clearSessionCookies());
it("encodes session values without allowing cookie-attribute injection and clears them on logout", () => {
  persistSessionCookie({ tokenName: "satoken", tokenValue: "token; other=bad" });
  expect(document.cookie).toContain("satoken=token%3B%20other%3Dbad");
  expect(document.cookie).not.toContain("; other=");
  clearSessionCookies();
  expect(document.cookie).not.toContain("satoken=");
});
it("clears accepted custom token names as well as the default name", () => {
  persistSessionCookie({ tokenName: "session.custom", tokenValue: "custom" });
  expect(document.cookie).toContain("session.custom=custom");
  clearSessionCookies();
  expect(document.cookie).not.toContain("session.custom=");
});
