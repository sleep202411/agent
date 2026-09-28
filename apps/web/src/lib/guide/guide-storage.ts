const STORAGE_KEY = "fizzdragon_guide";
const isDev = process.env.NODE_ENV === "development";

function getStore(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return stored && typeof stored === "object" && !Array.isArray(stored)
      ? (stored as Record<string, boolean>)
      : {};
  } catch {
    return {};
  }
}

function setStore(store: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {}
}

export function isGuideCompleted(guideId: string): boolean {
  if (isDev) return false;
  return getStore()[guideId] === true;
}

export function markGuideCompleted(guideId: string): void {
  if (isDev) return;
  const store = getStore();
  store[guideId] = true;
  setStore(store);
}

export function resetGuide(guideId: string): void {
  const store = getStore();
  delete store[guideId];
  setStore(store);
}

export function resetAllGuides(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Match the best-effort storage contract used by guide reads and writes.
  }
}
