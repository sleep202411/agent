import { Platform } from "react-native";
import type { AuthToken } from "./types";
const knownNames = new Set<string>(["satoken"]);
function cookieScope() {
  const host = window.location.hostname;
  const domain =
    host === "localhost" || /^[\d.]+$/.test(host)
      ? ""
      : `; Domain=.${host.split(".").slice(-2).join(".")}`;
  return `; Path=/${domain}; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
}
/** Only auth-store acceptance may publish a browser session cookie. */
export function persistSessionCookie(token?: AuthToken) {
  if (!token || Platform.OS !== "web" || typeof document === "undefined") return;
  knownNames.add(token.tokenName);
  document.cookie = `${encodeURIComponent(token.tokenName)}=${encodeURIComponent(token.tokenValue)}${cookieScope()}; Max-Age=${60 * 60 * 24 * 30}`;
}
export function clearSessionCookies(token?: AuthToken) {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  if (token) knownNames.add(token.tokenName);
  for (const name of knownNames) {
    const prefix = `${encodeURIComponent(name)}=; Max-Age=0`;
    document.cookie = `${prefix}${cookieScope()}`;
    // Also remove host-only cookies, including backend fallbacks on local Web.
    document.cookie = `${prefix}; Path=/; SameSite=Lax`;
  }
  knownNames.clear();
  knownNames.add("satoken");
}
