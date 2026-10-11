import { z } from "zod";
export function kycNavigation(
  value: string,
  initialUri: string,
  returnUrl: string
): "return" | "provider" | "blocked" {
  try {
    const url = new URL(value),
      provider = new URL(initialUri),
      target = new URL(returnUrl);
    if (url.protocol !== "https:" || url.username || url.password) return "blocked";
    if (url.origin === target.origin && url.pathname === target.pathname) return "return";
    return url.origin === provider.origin ? "provider" : "blocked";
  } catch {
    return "blocked";
  }
}
export function parseKycMetadata(raw: string) {
  const message = z
    .object({ type: z.literal("meta"), metaInfo: z.string().min(2).max(100000) })
    .parse(JSON.parse(raw));
  const metadata: unknown = JSON.parse(message.metaInfo);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    throw Error("Invalid device metadata");
  return message.metaInfo;
}
export const kycMetadataHtml = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script>
(function () {
  var completed = false;
  function post(payload) {
    if (completed) return;
    completed = true;
    window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  }
  var script = document.createElement('script');
  script.src = 'https://o.alicdn.com/yd-cloudauth/cloudauth-cdn/jsvm_all.js';
  script.onload = function () {
    try {
      if (typeof window.getMetaInfo !== 'function') throw Error('SDK unavailable');
      var info = window.getMetaInfo();
      post({type:'meta',metaInfo:typeof info === 'string' ? info : JSON.stringify(info)});
    } catch (_) { post({type:'error'}); }
  };
  script.onerror = function () { post({type:'error'}); };
  document.head.appendChild(script);
  setTimeout(function () { post({type:'error'}); },15000);
})();
</script></body></html>`;
