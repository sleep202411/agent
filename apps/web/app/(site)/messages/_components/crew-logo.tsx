"use client";

/**
 * A crew's face in the messages surface — the group-chat equivalent of
 * `<UserAvatar>`, used by both the inbox row and the conversation
 * header.
 *
 * Square-cornered rather than a circle, deliberately: crew rows sit in
 * the same list as people, and a round logo reads as "one more person"
 * at a glance. Falls back to the crew's generated mark when the logo is
 * missing.
 */

import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { crewLogoUrl } from "@/app/(site)/messages/_lib/crew-identity";

export function CrewLogo({
  logo,
  name,
  crewId,
  className,
}: {
  logo: string | null | undefined;
  name: string;
  crewId: string;
  className?: string;
}) {
  return (
    <UserAvatar
      src={crewLogoUrl(logo)}
      name={name}
      // Namespaced so a crew id can never collide with the user of the
      // same id in the generated-avatar space.
      seed={`crew:${crewId}`}
      className={cn("rounded-lg", className)}
      imageClassName="rounded-lg"
    />
  );
}
