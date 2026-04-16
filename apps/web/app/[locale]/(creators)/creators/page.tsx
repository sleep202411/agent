import { useMemo, useState } from "react";
import { MOCK_CREATORS } from "@/components/creators/creators-mock";
import { CreatorsHero } from "@/components/creators/creators-hero";
import { CreatorsSpotlight } from "@/components/creators/creators-spotlight";
import { CreatorsTalentGrid } from "@/components/creators/creators-talent-grid";
import { CreatorsFeed } from "@/components/creators/creators-feed";

export default function CreatorsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSkill, setSelectedSkill] = useState("All Skills");
  const [selectedLevel, setSelectedLevel] = useState("All Levels");
  const [sortBy, setSortBy] = useState("rating");

  const filteredCreators = useMemo(() => {
    const result = MOCK_CREATORS.filter((c) => {
      const matchSearch =
        !searchTerm ||
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.skills.some((s) => s.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchSkill = selectedSkill === "All Skills" || c.skills.includes(selectedSkill);
      const matchLevel = selectedLevel === "All Levels" || c.level === selectedLevel;
      return matchSearch && matchSkill && matchLevel;
    });

    result.sort((a, b) => {
      if (sortBy === "rating") return b.rating - a.rating;
      if (sortBy === "projects") return b.projects - a.projects;
      return b.joinedAt.localeCompare(a.joinedAt);
    });

    return result;
  }, [searchTerm, selectedSkill, selectedLevel, sortBy]);

  return (
    <div className="min-h-screen bg-background">
      <CreatorsHero
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        onSkillClick={(skill) => setSelectedSkill(skill === selectedSkill ? "All Skills" : skill)}
      />
      <CreatorsSpotlight />
      <CreatorsTalentGrid
        creators={filteredCreators}
        selectedSkill={selectedSkill}
        onSkillChange={setSelectedSkill}
        selectedLevel={selectedLevel}
        onLevelChange={setSelectedLevel}
        sortBy={sortBy}
        onSortChange={setSortBy}
      />
      <CreatorsFeed />
    </div>
  );
}
