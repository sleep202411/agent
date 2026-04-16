import { IconUsers, IconClock, IconChevronRight } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { STATUS_CONFIG, PHASE_DOT, type CrewItem } from "./crew-mock";

export function CrewCard({ studio }: { studio: CrewItem }) {
  const t = useTranslations("crew");
  const status = STATUS_CONFIG[studio.status];
  const dotClass = PHASE_DOT[studio.currentPhase] || "bg-primary";
  const roles = studio.rolesNeeded;

  return (
    <a
      href={`/crews/${studio.id}`}
      className="group block overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-border/80"
    >
      {/* Cover */}
      <div className="relative h-36 overflow-hidden bg-secondary">
        {studio.coverImage ? (
          <img
            src={studio.coverImage}
            alt={studio.name}
            className="size-full object-cover opacity-70 transition-opacity group-hover:opacity-90"
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-gradient-to-br from-primary/10 via-secondary to-accent/5">
            <span className="text-4xl font-black text-primary/20">{studio.name[0]}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/30 to-transparent" />
        <div className="absolute left-3 top-3">
          <span
            className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", status.badge)}
          >
            {t(status.labelKey)}
          </span>
        </div>
        <div className="absolute right-3 top-3">
          <span className="rounded-full border border-border/50 bg-background/60 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm">
            {studio.projectType}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="space-y-3 p-4">
        <div className="text-xs font-medium text-accent">IP: {studio.ipName}</div>
        <h3 className="line-clamp-1 text-base font-bold leading-tight text-foreground">
          {studio.name}
        </h3>
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {studio.description}
        </p>

        {/* Phase + progress */}
        <div className="flex items-center gap-2">
          <div className={cn("size-1.5 animate-pulse rounded-full", dotClass)} />
          <span className="text-xs text-foreground/70">{studio.currentPhase}</span>
          <div className="ml-1 h-1 flex-1 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${studio.progress}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">{studio.progress}%</span>
        </div>

        {/* Roles */}
        {roles.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {roles.slice(0, 4).map((role) => (
              <span
                key={role}
                className="rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs text-primary"
              >
                {role}
              </span>
            ))}
            {roles.length > 4 && (
              <span className="rounded-md bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                +{roles.length - 4}
              </span>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border pt-1">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <IconUsers className="size-3" />
              {studio.memberCount} {t("people")}
            </span>
            <span className="flex items-center gap-1">
              <IconClock className="size-3" />
              {studio.deadline}
            </span>
            <span className="text-accent">{studio.budgetRange}</span>
          </div>
        </div>

        {/* Producer */}
        <div className="flex items-center gap-2 pt-1">
          <div className="flex size-5 items-center justify-center rounded-full border border-primary/30 bg-primary/20 text-xs font-bold text-primary">
            {studio.producerName[0]}
          </div>
          <span className="text-xs text-muted-foreground">
            {t("producer")}: {studio.producerName}
          </span>
        </div>
      </div>
    </a>
  );
}
