/**
 * How a crew conversation identifies itself in the messages surface.
 *
 * `service` / `order` threads are two-party: the row and the header are
 * the counterparty's face and nickname. A crew thread is N-party, so the
 * server projects the CREW instead — `ConversationCardDTO` carries
 * `crewId` / `crewName` / `crewLogo` / `memberCount`, and
 * `counterpartyId` holds the crew id rather than a person (see the DTO
 * comment in `@repo/shared/conversation`). Resolving `counterpartyId` as
 * a user for these rows is the bug this module exists to prevent: it
 * would render "User 42" where the crew's name belongs, and fire a user
 * lookup for an id that is not a user.
 *
 * `crewName` / `crewLogo` / `memberCount` are optional even on a crew
 * row — the server omits them when it could not resolve the crew — so
 * every field here is nullable and the renderer falls back to a generic
 * "Crew chat" label rather than an empty header.
 */

import type { ConversationCardDTO } from "@repo/shared/conversation";
import { env } from "@/src/env";

export interface CrewConversationIdentity {
  crewId: string;
  /** NULL when the server could not resolve the crew's display row. */
  name: string | null;
  logo: string | null;
  memberCount: number | null;
}

/** The crew behind an inbox row, or NULL if the row is not a crew chat. */
export function crewIdentityOf(card: ConversationCardDTO): CrewConversationIdentity | null {
  if (card.contextType !== "crew") return null;
  return {
    // `crewId` mirrors `contextId`; prefer the explicit field and fall
    // back so a row still resolves if the projection ever drops it.
    crewId: card.crewId ?? card.contextId,
    name: card.crewName ?? null,
    logo: card.crewLogo ?? null,
    memberCount: card.memberCount ?? null,
  };
}

/**
 * Crew logo path → absolute URL.
 *
 * Crew logos are uploaded through `uploadBanner()` and live in the
 * banner bucket, NOT the primary OSS bucket — the crew hall card
 * (`app/(site)/crews/page.tsx`) resolves them the same way, and using
 * `OSS_BASE_URL` here returns 404. Empty input returns `undefined` so
 * the avatar falls through to its generated placeholder.
 */
export function crewLogoUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("http")) return path;
  const base = env.BANNER_BASE_URL.replace(/\/+$/, "");
  if (!base) return undefined;
  return `${base}/${path.replace(/^\/+/, "")}`;
}
