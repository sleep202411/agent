/**
 * Shared user-lookup wire types.
 *
 * The Nest `/aurora/users/lookup` endpoint proxies Java's user-by-contact
 * query and (optionally) enriches with crew-membership context so an
 * "Add member" UI can render a live preview in one round trip.
 */

export interface LookupUserDTO {
  /** Java user id (string — matches the rest of our wire). */
  userId: string;
  /** Display name. Empty string if Java returns nothing usable. */
  nickname: string;
  /** Browser/native-ready absolute URL or image data URI resolved by the BFF. */
  avatar: string | null;
  /** When the request supplied `checkCrewId`: true if this user is
   *  already an active member of that crew. NULL when the check wasn't
   *  requested (callers that don't care about a specific crew). */
  isCrewMember: boolean | null;
  /** Same convention as `isCrewMember` — true if this user is the
   *  current owner of the checked crew (owners are also members, but
   *  surface separately for clearer UI copy). */
  isCrewOwner: boolean | null;
}
