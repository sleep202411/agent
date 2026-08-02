import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/env", () => ({
  env: {
    USER_BASE_URL: "https://avatar.test",
    OSS_BASE_URL: "https://oss.test",
  },
}));

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children, ...props }: ComponentProps<"div">) => <div {...props}>{children}</div>,
  AvatarImage: ({ src, alt }: ComponentProps<"img">) => (
    <span data-avatar-src={src} data-avatar-alt={alt} />
  ),
  AvatarFallback: ({ children, ...props }: ComponentProps<"span">) => (
    <span {...props}>{children}</span>
  ),
}));

import { resolveUserAvatarUrl, UserAvatar } from "./user-avatar";

describe("UserAvatar", () => {
  it("resolves backend OSS object paths inside the shared component", () => {
    const markup = renderToStaticMarkup(
      <UserAvatar src="2259/avatar.png" seed="2259" name="Isaac" />
    );

    expect(markup).toContain('data-avatar-src="https://avatar.test/2259/avatar.png"');
  });

  it("keeps absolute avatar URLs unchanged", () => {
    expect(resolveUserAvatarUrl("https://cdn.test/avatar.png")).toBe("https://cdn.test/avatar.png");
    expect(resolveUserAvatarUrl("data:image/svg+xml;base64,PHN2Zy8+")).toBe(
      "data:image/svg+xml;base64,PHN2Zy8+"
    );
  });
});
