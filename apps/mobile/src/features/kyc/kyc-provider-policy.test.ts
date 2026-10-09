import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { kycMetadataHtml, kycNavigation, parseKycMetadata } from "./kyc-provider-policy";
const provider = "https://verify.aliyun.com/start",
  target = "https://fizzdragon.fizzspace.cn/zh-CN/kyc";
it.each([
  [provider, "provider"],
  [target + "?response=fixture", "return"],
  ["https://fizzdragon.fizzspace.cn/zh-CN/profile", "blocked"],
  ["https://fizzdragon.fizzspace.cn.evil.test/zh-CN/kyc", "blocked"],
  ["https://user:secret@verify.aliyun.com/start", "blocked"],
  ["http://verify.aliyun.com/start", "blocked"],
  ["file:///etc/passwd", "blocked"],
  ["javascript:alert(1)", "blocked"],
  ["invalid", "blocked"],
])("classifies provider navigation %s as %s", (url, result) =>
  expect(kycNavigation(url, provider, target)).toBe(result)
);
it("accepts SDK object metadata without altering it", () => {
  const metaInfo = '{"device":"fixture"}';
  expect(parseKycMetadata(JSON.stringify({ type: "meta", metaInfo }))).toBe(metaInfo);
});
it.each([
  "{}",
  "null",
  "[]",
  '{"type":"error"}',
  '{"type":"meta","metaInfo":"[]"}',
  '{"type":"meta","metaInfo":"null"}',
])("rejects malformed SDK messages: %s", (raw) => expect(() => parseKycMetadata(raw)).toThrow());
function sdk(getMetaInfo?: () => unknown) {
  const postMessage = vi.fn();
  let script!: { src: string; onload: () => void; onerror: () => void }, timeout!: () => void;
  runInNewContext(kycMetadataHtml.split("<script>")[1].split("</script>")[0], {
    window: { getMetaInfo, ReactNativeWebView: { postMessage } },
    document: {
      createElement: () => ({}),
      head: {
        appendChild: (value: typeof script) => {
          script = value;
        },
      },
    },
    setTimeout: (callback: () => void) => {
      timeout = callback;
    },
  });
  return { postMessage, script, timeout };
}
it("collects once even when a timeout and duplicate SDK event follow success", () => {
  const h = sdk(() => ({ device: "fixture" }));
  h.script.onload();
  h.timeout();
  h.script.onload();
  expect(h.postMessage).toHaveBeenCalledTimes(1);
  expect(parseKycMetadata(h.postMessage.mock.calls[0][0])).toBe('{"device":"fixture"}');
});
it.each(["missing", "error", "timeout"])(
  "reports %s SDK failure without a fake metadata result",
  (kind) => {
    const h = sdk();
    if (kind === "missing") h.script.onload();
    else if (kind === "error") h.script.onerror();
    else h.timeout();
    expect(JSON.parse(h.postMessage.mock.calls[0][0])).toEqual({ type: "error" });
  }
);
