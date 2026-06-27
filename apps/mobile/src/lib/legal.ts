import * as WebBrowser from "expo-web-browser";
import { appEnv } from "@/config";
import { getStoredString, setStoredString } from "@/lib/persistent-storage";

/**
 * Hosted legal pages + the local compliance flags the CN app stores require:
 *  - a first-launch privacy/terms consent gate, and
 *  - an in-app account-deletion request (kept as a local "under review" flag
 *    until the real deletion backend lands).
 */

// CN legal pages are served by the ACK web at fizzstudio.fizzspace.cn — that is
// where the app-store-required operator / ICP block on the privacy policy is
// live. (fizzdragon.fizzspace.cn is an older nginx-fronted backend that still
// serves a privacy page without that block.)
const SITE_BASE =
  appEnv.siteRegion === "cn" ? "https://fizzstudio.fizzspace.cn" : "https://fizzdragon.com";

/** Hosted legal URL. CN stores require the Chinese policy; otherwise follow the app locale. */
export function legalUrl(path: string, locale: string): string {
  const loc = appEnv.siteRegion === "cn" ? "zh-CN" : locale;
  return `${SITE_BASE}/${loc}${path}`;
}

/** Open a hosted legal page in an in-app browser (counts as "in-app"). */
export async function openLegal(path: string, locale: string): Promise<void> {
  await WebBrowser.openBrowserAsync(legalUrl(path, locale));
}

const CONSENT_KEY = "fizz_privacy_consent_v1";
const DELETION_KEY = "fizz_account_deletion_requested_v1";

export async function hasPrivacyConsent(): Promise<boolean> {
  return (await getStoredString(CONSENT_KEY)) === "1";
}

export async function setPrivacyConsent(): Promise<void> {
  await setStoredString(CONSENT_KEY, "1");
}

export async function isAccountDeletionRequested(): Promise<boolean> {
  return (await getStoredString(DELETION_KEY)) === "1";
}

export async function markAccountDeletionRequested(): Promise<void> {
  await setStoredString(DELETION_KEY, "1");
}
