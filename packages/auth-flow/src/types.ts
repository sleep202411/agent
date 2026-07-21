/**
 * Cross-app auth vocabulary. Nothing here is app- or framework-specific:
 * `apps/web` and `apps/studio` both speak exactly this.
 */

/** How Java is told to interpret `account` on `/user/new/*`. */
export type IdentifierKind = "phone" | "email";

/**
 * Which flow the shared identifier/code steps are serving.
 *
 * It lives here rather than next to the reducer because a code is issued
 * under a mode and stays bound to it: the two modes call DIFFERENT Java
 * endpoints (`/user/new/getCode` vs `/user/getCode`) and Java scopes each
 * code to the call that will spend it, so a sign-in code cannot complete
 * a reset and vice versa. Everything that remembers an outstanding code
 * — the reducer, the persisted `pending-code` record — has to remember
 * this with it.
 */
export type AuthMode = "signin" | "reset";

export interface NormalizedIdentifier {
  kind: IdentifierKind;
  /**
   * Wire value for Java's `account` param — already normalized
   * (lowercased email / country-code-stripped CN phone). Never send the
   * raw input: the two apps used to disagree on this and produced
   * "code sent to +86 138…, login rejected for 138…" mismatches.
   */
  account: string;
}

export interface SessionToken {
  /** Cookie name Sa-Token uses; `satoken` unless Java says otherwise. */
  name: string;
  value: string;
}

export interface AuthSession {
  token: SessionToken;
  /**
   * Java's `isNewUser` on `/user/new/login`. The one-button flow
   * auto-registers, so this is the ONLY signal that the profile / invite
   * onboarding steps apply.
   */
  isNewUser: boolean;
  userId?: string;
  identifier: NormalizedIdentifier;
}
