"use client";

import { IconPhoto } from "@tabler/icons-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * Shared project card — the source-style tile used by the home Recent Projects
 * rail and the /projects grid. Props are normalized (decoupled from any specific
 * project shape): map your data (PG canvas project, legacy MySQL project, …) onto
 * these. `cover` wins; else the workflow-canvas placeholder graphic if asked;
 * else a plain panel. Width is controlled by `className` (rail = fixed w-280,
 * grid = w-full).
 */
export interface ProjectCardProps {
  name: string;
  ownerName: string;
  metaLabel: string;
  cover?: string | null;
  href?: string;
  /** Show the decorative workflow-graph placeholder when there's no cover. */
  showWorkflowPreview?: boolean;
  /** Optional asset/credit overlay — only render when real counts exist. */
  metrics?: { assets: number; credits: number };
  className?: string;
  onMenuClick?: () => void;
}

export function ProjectCard({
  name,
  ownerName,
  metaLabel,
  cover,
  href,
  showWorkflowPreview,
  metrics,
  className,
  onMenuClick,
}: ProjectCardProps) {
  const body = (
    <article className="group w-full cursor-pointer overflow-hidden rounded-[16px] border border-white/[0.075] bg-[#151515] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] transition hover:border-white/[0.13] hover:shadow-[0_8px_24px_rgba(0,0,0,0.22)]">
      <div className="p-1">
        <div className="relative aspect-video w-full overflow-hidden rounded-[12px] bg-[#242424]">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cover}
              alt={name}
              loading="lazy"
              className="size-full object-cover transition duration-500 group-hover:scale-105"
            />
          ) : showWorkflowPreview ? (
            <WorkflowPreview />
          ) : (
            <div className="grid size-full place-items-center">
              <IconPhoto className="size-9 text-white/20" stroke={1.5} />
            </div>
          )}
          {metrics ? <ProjectMetrics assets={metrics.assets} credits={metrics.credits} /> : null}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 p-3 pt-2">
        <div className="min-w-0">
          <h3 className="truncate text-[14px] font-semibold leading-5 text-white/90">{name}</h3>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[14px] leading-5 text-white/55">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#83562a] text-[11px] font-semibold text-[#ffce92]">
              {(ownerName || "?").charAt(0).toUpperCase()}
            </span>
            <span className="truncate">{ownerName}</span>
            {metaLabel ? (
              <>
                <span className="shrink-0">-</span>
                <span className="truncate">{metaLabel}</span>
              </>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          aria-label="Project actions"
          className="grid size-8 shrink-0 place-items-center rounded-full text-white/90 transition hover:bg-white/[0.08]"
          onClick={(event) => {
            event.preventDefault();
            onMenuClick?.();
          }}
        >
          <DotsIcon />
        </button>
      </div>
    </article>
  );

  if (!href) return <div className={cn("block", className)}>{body}</div>;
  // Cross-app links (legacy projects → apps/web) are absolute URLs; the
  // localized next-intl Link is for in-studio routes only.
  if (/^https?:\/\//.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cn("block", className)}>
        {body}
      </a>
    );
  }
  return (
    <Link href={href} className={cn("block", className)}>
      {body}
    </Link>
  );
}

function ProjectMetrics({ assets, credits }: { assets: number; credits: number }) {
  return (
    <div className="absolute right-2 bottom-2 flex items-center gap-2">
      <MetricPill icon={<AssetIcon />} value={assets} label={assets === 1 ? "Asset" : "Assets"} />
      <MetricPill
        icon={<CreditIcon />}
        value={credits}
        label={credits === 1 ? "Credit" : "Credits"}
      />
    </div>
  );
}

function MetricPill({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <span className="flex h-6 items-center gap-1 rounded-full bg-[#101010]/90 px-2 text-[14px] font-semibold leading-none text-white/90 shadow-[0_2px_8px_rgba(0,0,0,0.32)] ring-1 ring-white/[0.05]">
      <span className="text-white/75">{icon}</span>
      {value} {label}
    </span>
  );
}

export function WorkflowPreview() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#242424]">
      <div className="absolute inset-0 opacity-[0.22] [background-image:radial-gradient(circle,rgba(255,255,255,0.35)_1px,transparent_1.4px)] [background-size:18px_18px]" />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 356 201" fill="none">
        <path
          d="M60 70 C102 68 106 124 151 121"
          stroke="#9A6528"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
        <path
          d="M209 90 C257 72 257 42 318 49"
          stroke="#5E853B"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
        <path
          d="M209 90 C255 105 262 142 318 139"
          stroke="#5E853B"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
        <circle cx="60" cy="70" r="2.6" fill="#A16A2B" />
        <circle cx="151" cy="121" r="2.6" fill="#A16A2B" />
        <circle cx="209" cy="90" r="3" fill="#66933F" />
        <circle cx="318" cy="49" r="2.6" fill="#66933F" />
        <circle cx="318" cy="139" r="2.6" fill="#66933F" />
      </svg>
      <WorkflowNode className="left-[22px] top-[52px]" width={50} lines={3} />
      <WorkflowNode className="left-[130px] top-[104px]" width={82} lines={2} />
      <WorkflowNode className="left-[185px] top-[73px]" width={52} lines={3} />
      <WorkflowNode className="left-[292px] top-[32px]" width={74} lines={3} />
      <WorkflowNode className="left-[292px] top-[121px]" width={74} lines={2} />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/20" />
    </div>
  );
}

function WorkflowNode({
  className,
  width,
  lines,
}: {
  className: string;
  width: number;
  lines: number;
}) {
  return (
    <div
      className={`absolute rounded-[5px] bg-[#171717]/90 px-2 py-1.5 shadow-[0_4px_12px_rgba(0,0,0,0.24)] ring-1 ring-white/[0.06] ${className}`}
      style={{ width }}
    >
      {Array.from({ length: lines }).map((_, index) => (
        <span
          key={index}
          className="mb-1 block h-[3px] rounded-full bg-white/20 last:mb-0"
          style={{ width: `${index === 0 ? 70 : index === 1 ? 100 : 48}%` }}
        />
      ))}
    </div>
  );
}

function AssetIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path
        d="M7.5 1.6 12 3.9v5.2l-4.5 2.3L3 9.1V3.9l4.5-2.3Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M3.3 4.1 7.5 6.3l4.2-2.2M7.5 6.4v4.7" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function CreditIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path
        d="M7.5 1.8 9 5.9l4.2 1.6L9 9.1l-1.5 4.1L6 9.1 1.8 7.5 6 5.9l1.5-4.1Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="5" cy="12" r="1.7" fill="currentColor" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <circle cx="19" cy="12" r="1.7" fill="currentColor" />
    </svg>
  );
}
