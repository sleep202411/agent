import { expect, it } from "vitest";
import { codeMenuDocument } from "./experience-code-menu-document";
it("keeps generated markup inside script/style and installs a capability port instead of ambient RPC", () => {
  const html = codeMenuDocument(
    {
      apiVersion: 1,
      surface: "main-menu",
      toolchain: "test",
      sourceHash: "a".repeat(64),
      artifactHash: "b".repeat(64),
      javascript: 'const text="</SCRIPT><script>bad()</script>";',
      css: 'p{content:"</STYLE><script>bad()</script>"}',
    },
    "one-time-credential"
  );
  expect(html).toContain("connect-src 'none'");
  expect(html).toContain("form-action 'none'");
  expect(html).not.toContain("unsafe-eval");
  expect(html).not.toContain("transact");
  expect(html).not.toContain("stateSnapshot");
  expect(html).toContain("event.source !== parent");
  expect(html).toContain("event.ports.length !== 1");
  expect(html).toContain("<\\/SCRIPT>");
  expect(html).toContain("<\\/STYLE>");
  expect((html.match(/<script nonce=/g) || []).length).toBe(2);
});
