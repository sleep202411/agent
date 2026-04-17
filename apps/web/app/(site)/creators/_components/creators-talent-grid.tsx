import { SKILL_OPTIONS, LEVEL_OPTIONS, SORT_OPTIONS, type Creator } from "./creators-mock";
import { CreatorsTalentCard } from "./creators-talent-card";

interface CreatorsTalentGridProps {
  creators: Creator[];
  selectedSkill: string;
  onSkillChange: (skill: string) => void;
  selectedLevel: string;
  onLevelChange: (level: string) => void;
  sortBy: string;
  onSortChange: (sort: string) => void;
}

export function CreatorsTalentGrid({
  creators,
  selectedSkill,
  onSkillChange,
  selectedLevel,
  onLevelChange,
  sortBy,
  onSortChange,
}: CreatorsTalentGridProps) {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-screen-2xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">
            All Creators
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {creators.length} found
            </span>
          </h2>
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1.5">
            {SKILL_OPTIONS.map((skill) => (
              <button
                key={skill}
                type="button"
                onClick={() => onSkillChange(skill)}
                className={`rounded-full px-3 py-1.5 text-xs transition-all ${
                  selectedSkill === skill
                    ? "border border-primary/40 bg-primary/10 text-primary"
                    : "border border-white/[0.06] bg-white/[0.03] text-muted-foreground hover:border-primary/20 hover:text-foreground"
                }`}
              >
                {skill}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <select
              value={selectedLevel}
              onChange={(e) => onLevelChange(e.target.value)}
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs text-foreground backdrop-blur-sm focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {LEVEL_OPTIONS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>

            <select
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value)}
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs text-foreground backdrop-blur-sm focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {SORT_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {creators.length > 0 ? (
          <div className="grid grid-cols-1 gap-x-4 gap-y-8 pt-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {creators.map((creator) => (
              <CreatorsTalentCard key={creator.id} creator={creator} />
            ))}
          </div>
        ) : (
          <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
            No creators found matching your filters
          </div>
        )}
      </div>
    </section>
  );
}
