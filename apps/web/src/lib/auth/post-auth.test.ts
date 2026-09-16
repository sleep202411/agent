import { describe, expect, it } from "vitest";
import { resolveRedirectTarget } from "./post-auth";

describe("post-login redirects", () => {
  it.each([
    "/\\outside.example",
    "/\n/outside.example",
    "/\t/outside.example",
    "//outside.example",
    "https://outside.example",
    "javascript:alert(1)",
  ])("rejects browser-normalized external target %j", (target) => {
    expect(resolveRedirectTarget(target)).toBeNull();
  });
  it.each([
    "/crews",
    "/en-US/crews?search=my crew#tasks",
    "/search?q=https%3A%2F%2Fexample.com",
    "/",
  ])("preserves local target %j", (target) => {
    expect(resolveRedirectTarget(target)).toBe(target);
  });
});
