"use client";

/**
 * `/register` — the same dialog as `/login`.
 *
 * There is no register/login distinction any more: one "Continue"
 * button, and Java auto-creates the account when the code checks out.
 * The URL survives because referral links are built against it —
 * `creator-center.tsx` shares `${origin}/register?recommendationCode=…`
 * and those links are already out in the wild.
 *
 * That `?recommendationCode=` is picked up by `<AuthDialogProvider>`'s
 * capture effect (see `src/lib/auth/referral.ts`) and replayed into the
 * invite step for brand-new accounts, which is the whole reason the
 * parameter exists.
 */

import { AuthRouteScreen } from "@/components/auth/auth-route-screen";

export default function RegisterPage() {
  return <AuthRouteScreen />;
}
