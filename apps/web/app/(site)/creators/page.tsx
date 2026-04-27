"use client";

import { useState } from "react";
import { useCreators } from "@/app/(site)/creators/_hooks/use-creator";
import { CreatorsHero } from "@/app/(site)/creators/_components/creators-hero";
import { CreatorsSpotlight } from "@/app/(site)/creators/_components/creators-spotlight";
import { CreatorsTalentGrid } from "@/app/(site)/creators/_components/creators-talent-grid";
import { CreatorsFeed } from "@/app/(site)/creators/_components/creators-feed";

export default function CreatorsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSkill, setSelectedSkill] = useState("All Skills");
  const [selectedLevel, setSelectedLevel] = useState("All Levels");
  const [sortBy, setSortBy] = useState<"rating" | "projects" | "recent">("rating");

  const { data: creators = [], isLoading } = useCreators({
    search: searchTerm,
    skill: selectedSkill,
    level: selectedLevel,
    sort: sortBy,
  });

  return (
    <div className="min-h-screen bg-background">
      <CreatorsHero
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        onSkillClick={(skill) => setSelectedSkill(skill === selectedSkill ? "All Skills" : skill)}
      />
      <CreatorsSpotlight />
      <CreatorsTalentGrid
        creators={creators}
        isLoading={isLoading}
        selectedSkill={selectedSkill}
        onSkillChange={setSelectedSkill}
        selectedLevel={selectedLevel}
        onLevelChange={setSelectedLevel}
        sortBy={sortBy}
        onSortChange={(v) => setSortBy(v as typeof sortBy)}
        onClear={() => {
          setSearchTerm("");
          setSelectedSkill("All Skills");
          setSelectedLevel("All Levels");
          setSortBy("rating");
        }}
      />
      <CreatorsFeed />
    </div>
  );
}
