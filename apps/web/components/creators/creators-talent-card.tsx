import { IconStar, IconTrophy, IconClock, IconWorld, IconUserPlus } from "@tabler/icons-react";
import { LEVEL_COLORS, AVAILABILITY_CONFIG, type Creator } from "./creators-mock";

export function CreatorsTalentCard({ creator }: { creator: Creator }) {
  const levelStyle = LEVEL_COLORS[creator.level];
  const avail = AVAILABILITY_CONFIG[creator.availability];

  return (
    <div className="group relative mt-8 rounded-xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm transition-all hover:border-primary/30 hover:bg-white/[0.06] hover:shadow-lg hover:shadow-primary/5">
      {/* Avatar - protruding above card */}
      <div className="absolute -top-8 left-1/2 -translate-x-1/2">
        <div className="relative">
          <div className="flex size-16 items-center justify-center rounded-full border-3 border-background bg-gradient-to-br from-primary/30 to-violet-500/30 text-xl font-bold text-primary shadow-lg shadow-primary/10 backdrop-blur-sm transition-transform group-hover:scale-105">
            {creator.name.charAt(0)}
          </div>
          {/* Online indicator */}
          {creator.availability === "available" && (
            <span className="absolute bottom-0 right-0 size-3.5 rounded-full border-2 border-background bg-green-400" />
          )}
        </div>
      </div>

      {/* Invite button */}
      <button
        type="button"
        className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-lg bg-white/[0.06] text-muted-foreground opacity-0 transition-all hover:bg-primary hover:text-white group-hover:opacity-100"
        title="Invite to project"
      >
        <IconUserPlus className="size-3.5" />
      </button>

      {/* Content */}
      <div className="px-4 pb-4 pt-10 text-center">
        {/* Name + Level */}
        <div className="flex items-center justify-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{creator.name}</span>
          <span
            className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${levelStyle.text} ${levelStyle.bg} ${levelStyle.border}`}
          >
            {creator.level}
          </span>
        </div>

        {/* Rating + Location */}
        <div className="mt-1 flex items-center justify-center gap-3 text-[11px]">
          <span className="flex items-center gap-0.5 text-amber-400">
            <IconStar className="size-3 fill-current" /> {creator.rating}
          </span>
          <span className="text-muted-foreground">({creator.reviews})</span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <IconWorld className="size-3" /> {creator.location}
          </span>
        </div>

        {/* Bio */}
        <p className="mt-2.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
          {creator.bio}
        </p>

        {/* Skills */}
        <div className="mt-3 flex flex-wrap justify-center gap-1">
          {creator.skills.map((skill) => (
            <span
              key={skill}
              className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              {skill}
            </span>
          ))}
        </div>

        {/* Footer stats */}
        <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <IconTrophy className="size-3" /> {creator.projects}
          </span>
          <span className="flex items-center gap-1">
            <IconClock className="size-3" /> {creator.responseTime}
          </span>
          <span className={`flex items-center gap-1 ${avail.text}`}>
            <span className={`size-1.5 rounded-full ${avail.dot}`} /> {avail.label}
          </span>
        </div>
      </div>
    </div>
  );
}
