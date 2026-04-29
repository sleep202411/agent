"use client";

import { useEffect, useRef } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { useCreators } from "@/app/(site)/creators/_hooks/use-creator";
import { CreatorsHero } from "@/app/(site)/creators/_components/creators-hero";
import { CreatorsTalentGrid } from "@/app/(site)/creators/_components/creators-talent-grid";

export default function CreatorsPage() {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useCreators();
  const creators = data?.list ?? [];
  const total = data?.total ?? creators.length;

  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "320px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  return (
    <div className="min-h-screen bg-background">
      <CreatorsHero total={total} />
      <CreatorsTalentGrid creators={creators} isLoading={isLoading} />
      <div ref={sentinelRef} aria-hidden className="h-px w-full" />
      {isFetchingNextPage && (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <IconLoader2 className="size-5 animate-spin" />
        </div>
      )}
    </div>
  );
}
