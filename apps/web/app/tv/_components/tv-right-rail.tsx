"use client";

import { TvComments } from "./tv-comments";

export function TvRightRail({ ipId }: { ipId: string | null }) {
  if (!ipId) return null;
  return (
    <aside className="flex w-full shrink-0 flex-col border-t border-white/10 lg:h-full lg:w-72 lg:overflow-hidden lg:border-l lg:border-t-0 xl:w-80">
      <TvComments key={ipId} ipId={ipId} />
    </aside>
  );
}
