import { describe, expect, it } from "vitest";

import {
  dicebearUserAvatarUrl,
  isPlaceholderUserAvatar,
  resolveUserAvatarUrl,
  USER_AVATAR_PLACEHOLDER_UUID,
  userAvatarSeed,
} from "./avatar.js";

describe("user avatar policy", () => {
  it("resolves a backend OSS key against the platform base", () => {
    expect(resolveUserAvatarUrl("2259/avatar.png", "https://avatar.test/")).toBe(
      "https://avatar.test/2259/avatar.png"
    );
  });

  it("passes browser-ready sources through", () => {
    expect(resolveUserAvatarUrl("https://cdn.test/avatar.png")).toBe("https://cdn.test/avatar.png");
    expect(resolveUserAvatarUrl("//cdn.test/avatar.png")).toBe("https://cdn.test/avatar.png");
    expect(resolveUserAvatarUrl("data:image/svg+xml;base64,PHN2Zy8+")).toBe(
      "data:image/svg+xml;base64,PHN2Zy8+"
    );
  });

  it("rejects missing and legacy placeholder avatars", () => {
    expect(resolveUserAvatarUrl(undefined, "https://avatar.test")).toBeUndefined();
    expect(resolveUserAvatarUrl("users/avatar.png")).toBeUndefined();
    expect(isPlaceholderUserAvatar(`https://avatar.test/${USER_AVATAR_PLACEHOLDER_UUID}.png`)).toBe(
      true
    );
  });

  it("keeps the deterministic fallback identity stable across runtimes", () => {
    const seed = userAvatarSeed(2259);
    expect(seed).toBe("user:2259");
    expect(dicebearUserAvatarUrl(seed)).toContain(
      "/9.x/notionists/png?seed=user%3A2259&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf"
    );
  });
});
