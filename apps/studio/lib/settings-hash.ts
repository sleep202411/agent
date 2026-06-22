/**
 * Settings is a hash-driven modal (`#settings/<section>`) — the route never
 * changes, so the app stays mounted behind it and a refresh re-opens the same
 * modal. This module is the tiny shared control surface used by both the global
 * SettingsOverlay and every entry point.
 */
export type SettingsSection =
  | "account"
  | "overview"
  | "members"
  | "usage"
  | "analytics"
  | "billing";

export const SETTINGS_HASH = "settings";

const SECTIONS: SettingsSection[] = [
  "account",
  "overview",
  "members",
  "usage",
  "analytics",
  "billing",
];

/** Open the settings modal at a section, keeping the current page/route. */
export function openSettings(section: SettingsSection = "account") {
  window.location.hash = `${SETTINGS_HASH}/${section}`;
}

/** The section a hash addresses, or null when it isn't a settings hash. */
export function parseSettingsHash(hash: string): SettingsSection | null {
  const raw = hash.replace(/^#/, "");
  if (raw !== SETTINGS_HASH && !raw.startsWith(`${SETTINGS_HASH}/`)) return null;
  const section = raw.split("/")[1];
  return (SECTIONS as string[]).includes(section) ? (section as SettingsSection) : "account";
}
