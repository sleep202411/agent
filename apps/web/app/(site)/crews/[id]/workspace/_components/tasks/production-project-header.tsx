"use client";

import { useEffect, useRef, useState } from "react";
import { IconEdit, IconLoader2 } from "@tabler/icons-react";
import type { LookupUserDTO } from "@repo/shared/users";
import { toast } from "sonner";

import {
  useUpdateCrew,
  type CrewMemberDTO,
  type CrewProductionOverviewDTO,
} from "@/app/(site)/crews/_hooks/use-crew";
import { CrewLogo } from "@/app/(site)/messages/_components/crew-logo";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { ProductionProjectProperties } from "./production-project-properties";
import { ProductionProjectResources } from "./production-project-resources";

interface ProductionProjectHeaderProps {
  crewId: string;
  crewName: string;
  crewSummary: string;
  crewLogo: string;
  crewVersion: number;
  canEditCrewInfo: boolean;
  members: CrewMemberDTO[];
  displays: Map<string, LookupUserDTO>;
  overview: CrewProductionOverviewDTO;
  saveState: "saved" | "saving" | "error";
  onReload: () => void;
  onWriteUpdate: () => void;
}

export function ProductionProjectHeader({
  crewId,
  crewName,
  crewSummary,
  crewLogo,
  crewVersion,
  canEditCrewInfo,
  members,
  displays,
  overview,
  saveState,
  onReload,
  onWriteUpdate,
}: ProductionProjectHeaderProps) {
  const t = useTranslations("crewProduction");
  const updateCrew = useUpdateCrew();

  const updateCrewText = async (
    field: "name" | "tagline",
    value: string,
    expectedVersion: number
  ) => {
    if (field === "name" && !value) {
      toast.error(t("projectInfo.nameRequired"));
      return false;
    }

    try {
      await updateCrew.mutateAsync({
        id: crewId,
        expectedVersion,
        [field]: field === "tagline" && !value ? null : value,
      });
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("projectInfo.saveFailed"));
      return false;
    }
  };

  return (
    <header className="px-6 sm:px-10 lg:px-14">
      <div className="flex items-center justify-between">
        <CrewLogo
          logo={crewLogo}
          name={crewName}
          crewId={crewId}
          className="size-9 shrink-0 rounded-[8px] ring-1 ring-white/[0.07]"
        />
        <SaveIndicator state={updateCrew.isPending ? "saving" : saveState} onReload={onReload} />
      </div>

      <div className="mt-4 min-w-0">
        <h2>
          <EditableProjectText
            value={crewName}
            version={crewVersion}
            disabled={!canEditCrewInfo || updateCrew.isPending}
            maxLength={128}
            ariaLabel={t("projectInfo.nameLabel")}
            className="text-[26px] font-semibold leading-8 tracking-[-0.025em] text-[#ededee] placeholder:text-[#555960]"
            onSave={(value, version) => updateCrewText("name", value, version)}
          />
        </h2>
        <p className="mt-1 max-w-2xl">
          <EditableProjectText
            value={crewSummary}
            version={crewVersion}
            disabled={!canEditCrewInfo || updateCrew.isPending}
            maxLength={140}
            ariaLabel={t("projectInfo.summaryLabel")}
            placeholder={t("projectInfo.summaryPlaceholder")}
            className="text-[13px] leading-5 text-[#85868c] placeholder:text-[#5e6269]"
            onSave={(value, version) => updateCrewText("tagline", value, version)}
          />
        </p>
      </div>

      <div className="mt-7 space-y-3.5 text-[12px]">
        <ProductionProjectProperties
          crewId={crewId}
          crewName={crewName}
          crewLogo={crewLogo}
          members={members}
          displays={displays}
          overview={overview}
        />
        <ProductionProjectResources crewId={crewId} overview={overview} />
      </div>

      <button
        type="button"
        onClick={onWriteUpdate}
        className="mt-6 flex h-16 w-full items-center justify-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.012] text-[12px] font-medium text-[#a7abb2] transition-colors hover:border-white/[0.11] hover:bg-white/[0.03] hover:text-[#e1e3e6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
      >
        <IconEdit className="size-4" />
        {overview.latestUpdate ? t("updates.writeAnother") : t("updates.writeFirst")}
      </button>
    </header>
  );
}

function EditableProjectText({
  value,
  version,
  disabled,
  maxLength,
  ariaLabel,
  placeholder,
  className,
  onSave,
}: {
  value: string;
  version: number;
  disabled: boolean;
  maxLength: number;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  onSave: (value: string, expectedVersion: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value);
  const draftBase = useRef<{ version: number; value: string } | null>(null);
  const focused = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!focused.current && draftBase.current === null) setDraft(value);
  }, [value]);

  const commit = async () => {
    focused.current = false;
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const next = draft.trim();
    if (next === value || next === draftBase.current?.value.trim()) {
      draftBase.current = null;
      setDraft(value);
      return;
    }
    // Failed saves already surface an error; retain the draft for correction or retry.
    if (await onSave(next, draftBase.current?.version ?? version)) {
      draftBase.current = null;
      setDraft(next);
    }
  };

  return (
    <input
      type="text"
      value={draft}
      readOnly={disabled}
      maxLength={maxLength}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onFocus={() => {
        focused.current = true;
        draftBase.current ??= { version, value };
      }}
      onChange={(event) => {
        draftBase.current ??= { version, value };
        setDraft(event.target.value);
      }}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          cancelled.current = true;
          draftBase.current = null;
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
      className={cn(
        "block w-full truncate border-0 bg-transparent p-0 outline-none focus:ring-0",
        disabled ? "cursor-default" : "cursor-text",
        className
      )}
    />
  );
}

function SaveIndicator({
  state,
  onReload,
}: {
  state: "saved" | "saving" | "error";
  onReload: () => void;
}) {
  const t = useTranslations("crewProduction");
  if (state === "saved") return null;

  return (
    <div
      className="flex h-8 shrink-0 items-center gap-2 text-[11px] text-[#717278]"
      aria-live="polite"
    >
      {state === "saving" ? <IconLoader2 className="size-3 animate-spin" /> : null}
      <span>{t(`saveState.${state}`)}</span>
      {state === "error" ? (
        <button
          type="button"
          onClick={onReload}
          className="rounded-[5px] px-2 py-1 text-[#d7d7da] hover:bg-white/[0.05]"
        >
          {t("saveState.reload")}
        </button>
      ) : null}
    </div>
  );
}
