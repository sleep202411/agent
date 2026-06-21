"use client";

import { useEffect, useState } from "react";

/**
 * Preview gate for the not-yet-released community-membership (社区会员) entries.
 * The membership product exists and is purchasable, but its benefits (member-free
 * viewing + IP discount + the creator pool) are Phases 2–5 and not built yet, so
 * the entry points must NOT be visible to real users — buying now would grant no
 * working benefit.
 *
 * Visible only when `localStorage.fizzMembershipPreview === '1'` (set it in
 * DevTools to dogfood on prod). Read client-side after mount to avoid an SSR
 * hydration mismatch. DELETE this gate (and its call sites) once the benefits
 * ship and membership goes GA.
 */
export function useMembershipPreview(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    try {
      setEnabled(window.localStorage.getItem("fizzMembershipPreview") === "1");
    } catch {
      setEnabled(false);
    }
  }, []);
  return enabled;
}
