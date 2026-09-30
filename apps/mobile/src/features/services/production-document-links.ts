/** Only canonical-document links can be selected. The bridge never supplies a URL. */
export function documentLinkIndex(message: unknown): number | null {
  if (typeof message !== "string" || message.length > 120) return null;
  try {
    const value = JSON.parse(message);
    return value &&
      Object.keys(value).length === 2 &&
      value.type === "production-link" &&
      Number.isSafeInteger(value.index) &&
      value.index >= 0
      ? value.index
      : null;
  } catch {
    return null;
  }
}

export function resolveDocumentLink(href: string, webOrigin: string): string | null {
  if (href.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(href)) return null;
  // Local anchors are handled by the offline document, never handed to the OS.
  if (href.startsWith("#")) return null;
  try {
    const base = new URL(webOrigin);
    if (!["https:", "http:"].includes(base.protocol)) return null;
    if (href.startsWith("/") && !href.startsWith("//")) return new URL(href, base.origin).href;
    const url = new URL(href);
    if (
      !["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    if ((url.protocol === "http:" || url.protocol === "https:") && !/^https?:\/\//i.test(href))
      return null;
    return url.href;
  } catch {
    return null;
  }
}

// Static, trusted script. Content and link URLs are never interpolated into JavaScript.
export const DOCUMENT_LINK_SCRIPT = `document.addEventListener('click',function(event){
var link=event.target.closest('a[data-document-link]');if(!link)return;event.preventDefault();
var fragment=link.getAttribute('data-fragment');if(fragment!==null){if(!fragment){document.documentElement.scrollTop=0;document.body.scrollTop=0;return;}var target=document.getElementById(fragment);if(target)target.scrollIntoView();return;}
var index=Number(link.getAttribute('data-document-link'));if(!Number.isSafeInteger(index)||index<0)return;
var message=JSON.stringify({type:'production-link',index:index});
if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(message);}else{window.parent.postMessage(message,'*');}
});`;
