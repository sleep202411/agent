"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { IconUserCog, IconChevronDown, IconCheck } from "@tabler/icons-react";
import {
  parseIdentity,
  setDevIdentity,
  serializeIdentity,
  useDevIdentityRaw,
  type Identity,
} from "@/app/(site)/crews/_hooks/use-dev-identity";
import { useCrewMembers } from "@/app/(site)/crews/_hooks/use-crew";
import { useProjectRoles } from "@/app/(site)/crews/_hooks/use-projects";
import { cn } from "@/lib/utils";

/**
 * Floating dev-only identity switcher. Lets you impersonate the
 * owner, any specific crew member (by their production role), or a
 * visitor with no relationship to the crew. Hidden in production.
 */
export function DevIdentitySwitcher() {
  const params = useParams<{ id: string }>();
  const crewId = params.id;
  const raw = useDevIdentityRaw();
  const identity = parseIdentity(raw);
  // Real crew members from `/project/crew/member/query`. Switcher
  // only needs name + role for impersonation labels.
  const { data: crewMembers = [] } = useCrewMembers(crewId);
  const { data: projectRoles = [] } = useProjectRoles();
  const roleNameById = useMemo(
    () => new Map(projectRoles.map((r) => [r.id, r.name])),
    [projectRoles]
  );
  const members = useMemo(
    () =>
      crewMembers.map((m) => ({
        name: m.nick?.trim() || `User ${m.userId}`,
        role: (m.roleId != null && roleNameById.get(m.roleId)) || "—",
      })),
    [crewMembers, roleNameById]
  );

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (process.env.NODE_ENV === "production") return null;

  const label = identityLabel(identity, members);

  const choose = (next: Identity) => {
    setDevIdentity(serializeIdentity(next));
    setOpen(false);
  };

  return (
    <div ref={ref} className="fixed bottom-4 right-4 z-50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-white/15 bg-black/80 px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur-md transition-colors hover:bg-black/90"
      >
        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-white/60">
          <IconUserCog className="size-3.5" /> Dev
        </span>
        <span className="text-[11px] font-medium text-white">{label}</span>
        <IconChevronDown
          className={cn("size-3.5 text-white/60 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-64 overflow-hidden rounded-2xl border border-white/15 bg-black/90 shadow-2xl backdrop-blur-xl">
          <Section label="Outside the crew">
            <Row
              active={identity.kind === "visitor"}
              onClick={() => choose({ kind: "visitor" })}
              title="Visitor"
              subtitle="Not in the crew"
            />
          </Section>
          <Section label="Crew owner">
            <Row
              active={identity.kind === "owner"}
              onClick={() => choose({ kind: "owner" })}
              title="Owner"
              subtitle="Producer / creator"
            />
          </Section>
          {members.length > 0 && (
            <Section label="Members">
              <div className="max-h-64 overflow-y-auto">
                {members.map((m) => (
                  <Row
                    key={m.name}
                    active={identity.kind === "member" && identity.name === m.name}
                    onClick={() => choose({ kind: "member", name: m.name })}
                    title={m.name}
                    subtitle={m.role}
                  />
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-white/5 last:border-0">
      <div className="px-3 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-widest text-white/40">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors",
        active ? "bg-white/10 text-white" : "text-white/80 hover:bg-white/5"
      )}
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-[11px] text-white/50">{subtitle}</div>
      </div>
      {active && <IconCheck className="size-4 shrink-0 text-primary" />}
    </button>
  );
}

function identityLabel(identity: Identity, members: { name: string; role: string }[]): string {
  if (identity.kind === "visitor") return "Visitor";
  if (identity.kind === "owner") return "Owner";
  const m = members.find((x) => x.name === identity.name);
  return m ? `${m.name} · ${m.role}` : identity.name;
}
