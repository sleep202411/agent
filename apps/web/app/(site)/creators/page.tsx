"use client";

import { useCreators } from "@/app/(site)/creators/_hooks/use-creator";
import { CreatorsHero } from "@/app/(site)/creators/_components/creators-hero";
import { CreatorsTalentGrid } from "@/app/(site)/creators/_components/creators-talent-grid";

export default function CreatorsPage() {
  const { data: creators = [], isLoading } = useCreators();

  return (
    <div className="min-h-screen bg-background">
      <CreatorsHero total={creators.length} />
      <CreatorsTalentGrid creators={creators} isLoading={isLoading} />
    </div>
  );
}
