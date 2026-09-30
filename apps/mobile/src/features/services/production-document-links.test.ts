import { expect, it, vi } from "vitest";
import {
  documentLinkIndex,
  resolveDocumentLink,
  DOCUMENT_LINK_SCRIPT,
} from "./production-document-links";
import { renderProductionDocument } from "./production-document-html";
const base = "https://fizzdragon.fizzspace.cn";
it.each([
  "javascript:alert(1)",
  "data:text/html,x",
  "file:///tmp/x",
  "intent://x",
  "//other.example/path",
  "/\\other.example",
  "https://name:secret@example.com",
  " https://example.com",
  "https://exam\nple.com",
  "https:example.com",
  "#section",
])("rejects unsafe/nonexternal OS link %s", (href) => {
  expect(resolveDocumentLink(href, base)).toBeNull();
});
it.each([
  "https://example.com/path?q=1",
  "http://example.com/",
  "mailto:artist@example.com",
  "tel:+123456789",
])("preserves supported link %s", (href) => {
  expect(resolveDocumentLink(href, base)).toBe(href);
});
it("resolves internal links on the configured site", () => {
  expect(resolveDocumentLink("/en-US/crews?x=1", base)).toBe(base + "/en-US/crews?x=1");
});
it.each([
  null,
  {},
  "{}",
  '{"type":"production-link","index":-1}',
  '{"type":"production-link","index":0.5}',
  '{"type":"production-link","index":0,"url":"https://other.example"}',
  '{"type":"production-link","index":"0"}',
  "x".repeat(121),
])("rejects invalid bridge messages %j", (value) => {
  expect(documentLinkIndex(value)).toBeNull();
});
it("accepts only an index, never a URL", () => {
  expect(documentLinkIndex('{"type":"production-link","index":0}')).toBe(0);
});
const id = "11111111-1111-4111-8111-111111111111";
it("renders known emoji without requesting remote images and keeps unknown names", () => {
  const { html } = renderProductionDocument({
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { id },
        content: [
          { type: "emoji", attrs: { name: "smile" } },
          { type: "emoji", attrs: { name: "unknown" } },
        ],
      },
    ],
  });
  expect(html).toContain("😄");
  expect(html).toContain(":unknown:");
  expect(html).not.toContain("<img");
});
it("bridge only sends canonical indexes on click and scrolls local anchors", () => {
  const { html, links } = renderProductionDocument({
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { id },
        content: [
          {
            type: "text",
            text: "Open",
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          },
          { type: "text", text: "Local", marks: [{ type: "link", attrs: { href: "#" + id } }] },
        ],
      },
    ],
  });
  const doc = document.implementation.createHTMLDocument();
  doc.documentElement.innerHTML = html;
  const postMessage = vi.fn();
  // Exercise the trusted bridge against an isolated document; user text never enters script code.
  new Function("document", "window", DOCUMENT_LINK_SCRIPT)(doc, {
    ReactNativeWebView: { postMessage },
  });
  expect(postMessage).not.toHaveBeenCalled();
  doc.querySelector("a")!.click();
  expect(postMessage).toHaveBeenCalledWith('{"type":"production-link","index":0}');
  expect(links[0]).toBe("https://example.com");
  const target = doc.getElementById(id)!;
  target.scrollIntoView = vi.fn();
  doc.querySelectorAll("a")[1].click();
  expect(target.scrollIntoView).toHaveBeenCalledOnce();
  expect(postMessage).toHaveBeenCalledTimes(1);
});

it("handles an empty fragment as a local top link without an OS request", () => {
  const { html } = renderProductionDocument({
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { id },
        content: [{ type: "text", text: "Top", marks: [{ type: "link", attrs: { href: "#" } }] }],
      },
    ],
  });
  const doc = document.implementation.createHTMLDocument();
  doc.documentElement.innerHTML = html;
  doc.documentElement.scrollTop = 100;
  const postMessage = vi.fn();
  new Function("document", "window", DOCUMENT_LINK_SCRIPT)(doc, {
    ReactNativeWebView: { postMessage },
  });
  doc.querySelector("a")!.click();
  expect(doc.documentElement.scrollTop).toBe(0);
  expect(postMessage).not.toHaveBeenCalled();
});
