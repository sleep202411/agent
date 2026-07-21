"use client";

/**
 * `/forgot-password` — kept as a URL, opens the same dialog in reset mode.
 *
 * The dedicated two-pane form is gone; the flow it ran is not. `intent:
 * "reset"` starts the dialog on identifier → code → NEW password →
 * signed in, against the same `/user/(email/)reset/password` endpoints
 * that page used. That is the point of a reset: the user ends up holding
 * a password they know, not merely signed in once by code.
 *
 * Everywhere else the affordance is hidden — it appears only in the
 * dialog's password step, because the code flow has no password to have
 * forgotten. This URL is the exception: someone who typed it has already
 * told us which problem they have.
 *
 * Changing a password you still remember is a different job and lives in
 * the account-security panel in 个人中心 (`POST /user/set/password`).
 */

import { AuthRouteScreen } from "@/components/auth/auth-route-screen";

export default function ForgotPasswordPage() {
  return <AuthRouteScreen intent="reset" />;
}
