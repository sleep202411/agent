"use client";

import { SharedCreatorCenterLayout } from "@/app/(site)/creators/_components/center/creator-center";

interface ProfileCreatorCenterProps {
  creatorId: string;
}

/** `/profile`-only creator workspace with single-panel tab navigation. */
export function ProfileCreatorCenter({ creatorId }: ProfileCreatorCenterProps) {
  return <SharedCreatorCenterLayout creatorId={creatorId} contentMode="tabs" />;
}
