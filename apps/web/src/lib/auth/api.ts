/**
 * What is left of the app's own Java auth surface: ending a session.
 *
 * Signing IN belongs to `@repo/auth-flow`, which drives Java's current
 * contract (`/user/new/getCode` + `/user/new/login`, one auto-registering
 * code flow) and writes the satoken cookie itself. The email/phone
 * login / register / reset-password callers this file used to serve were
 * deleted with the two-pane auth pages, and their endpoints
 * (`/user/email/login`, `/user/regist`, `/user/reset/password`) are
 * SUPERSEDED — they are not kept here as reference, because a
 * ready-to-import function is how a retired contract gets wired back up.
 *
 *   Logout   GET /user/logout
 */

import { backendApi } from "@/src/lib/api";

export async function logout(): Promise<void> {
  await backendApi.get<unknown>("/user/logout");
}
