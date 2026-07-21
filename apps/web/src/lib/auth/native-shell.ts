"use client";

/**
 * Are we rendering inside the native app's WebView?
 *
 * `apps/mobile`'s `AuthedWebView` embeds apps/web pages and owns the
 * session itself: it injects the satoken, and it decides the session died
 * by watching for a navigation whose URL contains `/login`, at which point
 * it calls `stopLoading()` and shows its NATIVE sign-in prompt.
 *
 * That contract is why `/login` is still a real route, and it is also why
 * the client-side recovery paths (`<AuthGate>`, `<AuthInterceptor>`) must
 * keep NAVIGATING there when embedded instead of opening the web sign-in
 * dialog in place: the dialog would render inside the WebView, over a page
 * the shell already considers dead, and the user would be asked to sign in
 * twice in two different UIs.
 *
 * The marker is `applicationNameForUserAgent="FizzDragonApp"` on the
 * WebView, which WebKit/Chromium append to the standard user agent. It is
 * a one-way signal — nothing here changes rendering, only which recovery
 * gesture a dead session triggers — so a browser spoofing it merely gets
 * the pre-dialog behaviour.
 */

const NATIVE_SHELL_UA_MARKER = "FizzDragonApp";

export function isNativeShell(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.userAgent.includes(NATIVE_SHELL_UA_MARKER);
}
