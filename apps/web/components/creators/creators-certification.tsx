"use client";

import { IconAward, IconCircleCheck, IconBolt, IconLock } from "@tabler/icons-react";
import { MOCK_CERT_LEVELS, LEVEL_COLORS } from "./creators-mock";

const CURRENT_LEVEL_INDEX = 2;

export function CreatorsCertification() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-screen-2xl px-6 py-10">
        <div className="mb-8">
          <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <IconAward className="size-5 text-primary" /> FD Certification
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Level up through completed projects and unlock premium opportunities
          </p>
        </div>

        {/* Progress path */}
        <div className="relative mb-10">
          <div className="absolute left-0 right-0 top-5 h-0.5 bg-border" />
          <div
            className="absolute left-0 top-5 h-0.5 bg-gradient-to-r from-primary to-violet-400 transition-all"
            style={{
              width: `${(CURRENT_LEVEL_INDEX / (MOCK_CERT_LEVELS.length - 1)) * 100}%`,
            }}
          />

          <div className="relative flex justify-between">
            {MOCK_CERT_LEVELS.map((cert, index) => {
              const isCompleted = index < CURRENT_LEVEL_INDEX;
              const isCurrent = index === CURRENT_LEVEL_INDEX;
              const isLocked = index > CURRENT_LEVEL_INDEX;

              return (
                <div
                  key={cert.level}
                  className="flex flex-col items-center"
                  style={{ width: "20%" }}
                >
                  <div
                    className={`relative z-10 flex size-10 items-center justify-center rounded-full border-2 text-xs font-bold transition-all ${
                      isCurrent
                        ? "border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/30"
                        : isCompleted
                          ? "border-primary/50 bg-primary/20 text-primary"
                          : "border-border bg-card text-muted-foreground"
                    }`}
                  >
                    {isCompleted ? (
                      <IconCircleCheck className="size-4" />
                    ) : isLocked ? (
                      <IconLock className="size-3.5" />
                    ) : (
                      cert.level
                    )}
                    {isCurrent && (
                      <span className="absolute inset-0 animate-ping rounded-full border-2 border-primary opacity-20" />
                    )}
                  </div>
                  <span
                    className={`mt-2 text-xs font-medium ${isCurrent ? "text-primary" : isCompleted ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {cert.level}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{cert.name}</span>
                  <span className="text-[10px] text-muted-foreground">{cert.count} creators</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Detail cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {MOCK_CERT_LEVELS.map((cert, index) => {
            const levelStyle = LEVEL_COLORS[cert.level];
            const isCurrent = index === CURRENT_LEVEL_INDEX;

            return (
              <div
                key={cert.level}
                className={`rounded-xl border p-5 transition-all ${
                  isCurrent
                    ? "border-primary/40 bg-primary/5 shadow-lg shadow-primary/5"
                    : "border-white/[0.06] bg-white/[0.03] hover:border-primary/20"
                }`}
              >
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${levelStyle.text} ${levelStyle.bg} ${levelStyle.border}`}
                  >
                    {cert.level}
                  </span>
                  <span className="text-sm font-semibold text-foreground">{cert.name}</span>
                </div>

                <div className="mb-3">
                  <h4 className="mb-2 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    <IconCircleCheck className="size-3" /> Requirements
                  </h4>
                  <ul className="space-y-1.5">
                    {cert.requirements.map((req) => (
                      <li
                        key={req}
                        className="flex items-start gap-1.5 text-[11px] text-muted-foreground"
                      >
                        <IconCircleCheck className="mt-0.5 size-3 shrink-0 text-green-400/70" />
                        {req}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h4 className="mb-2 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    <IconBolt className="size-3" /> Perks
                  </h4>
                  <ul className="space-y-1.5">
                    {cert.perks.map((perk) => (
                      <li
                        key={perk}
                        className="flex items-start gap-1.5 text-[11px] text-muted-foreground"
                      >
                        <IconBolt className="mt-0.5 size-3 shrink-0 text-primary/70" />
                        {perk}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
