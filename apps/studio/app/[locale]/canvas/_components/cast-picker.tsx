"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconCheck, IconLoader2, IconUser, IconUserPlus } from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  MAX_CHARACTERS_PER_GENERATION,
  castCharacter,
  characterMediaContentUrl,
  listCast,
  listGrantedCharacters,
  type CastEntry,
  type CharacterSummary,
} from "@/lib/characters-api";
import { useCharacters } from "@/app/[locale]/(studio)/characters/_lib/use-characters";
import { getProject } from "@/lib/collab/projects-api";

/**
 * Cast picker popover — attaches a library character to a generation card.
 *
 * Two tabs, mirroring the ownership model (docs/character-library-…-v1.md §R3):
 *  - "Cast" (default): this PROJECT's 演员表 — the characters already cast here.
 *  - "Library": the project's home-workspace 演员池, with a one-click cast that
 *    also selects. The library is scoped to the PROJECT's workspace (a job's
 *    workspace resolves from its project, and a character is only castable into
 *    projects of its home workspace) — NOT the sidebar's active workspace,
 *    which can differ on shared projects. Project-only members simply get the
 *    server's typed 403 on the library tab — the cast tab is their surface.
 *
 * Strings live in the shared messages catalog under `canvasNodes.cast`
 * (English values across all locales, per the repo's English-first rule).
 */

// The library tab reuses the characters pages' list query (charactersKeys.list
// via useCharacters), so create/delete invalidations on either surface cover
// both. Only the picker-specific keys live here.
export const castPickerKeys = {
  project: (projectId: string) => ["fizzstudio", "project", projectId] as const,
  cast: (projectId: string) => ["fizzstudio", "characters", "cast", projectId] as const,
  granted: (projectId: string) => ["fizzstudio", "characters", "granted", projectId] as const,
};

/** This project's cast (shared by the picker and the card's chip covers). */
export function useProjectCast(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: castPickerKeys.cast(projectId),
    queryFn: () => listCast(projectId),
    enabled,
    staleTime: 30_000,
  });
}

/** Real_person characters GRANTED to this project — usable in generation via
 *  their grant (no cast row). Unioned into the Cast tab. */
export function useGrantedCharacters(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: castPickerKeys.granted(projectId),
    queryFn: () => listGrantedCharacters(projectId),
    enabled,
    staleTime: 30_000,
  });
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function CharacterThumb({ character }: { character: CharacterSummary }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/[0.06]">
      {character.coverAssetId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={characterMediaContentUrl(character.coverAssetId)}
          alt={character.name}
          className="size-full object-cover"
        />
      ) : (
        <IconUser className="size-5 text-white/70" stroke={1.7} />
      )}
    </span>
  );
}

function referenceCountTotal(character: CharacterSummary): number {
  return character.mediaCounts.image + character.mediaCounts.video + character.mediaCounts.audio;
}

function RowSkeletons() {
  return (
    <div className="space-y-1 p-1">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl p-2">
          <span className="size-10 shrink-0 animate-pulse rounded-lg bg-white/[0.06]" />
          <span className="flex-1 space-y-1.5">
            <span className="block h-3 w-2/5 animate-pulse rounded bg-white/[0.06]" />
            <span className="block h-2.5 w-1/4 animate-pulse rounded bg-white/[0.05]" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Small "real person" chip for granted real_person rows. */
function RealPersonBadge() {
  const t = useTranslations("canvasNodes.cast");
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-white/[0.09] px-1.5 py-0.5 text-[9px] font-medium text-white/70">
      <IconUser className="size-2.5" stroke={2} />
      {t("realPersonBadge")}
    </span>
  );
}

function CharacterRow({
  character,
  selected,
  disabled,
  disabledReason,
  badge,
  trailing,
  onClick,
}: {
  character: CharacterSummary;
  selected: boolean;
  disabled: boolean;
  disabledReason?: string;
  badge?: ReactNode;
  trailing?: ReactNode;
  onClick: () => void;
}) {
  const t = useTranslations("canvasNodes.cast");
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors",
        disabled ? "opacity-45" : "hover:bg-white/[0.06]",
        selected && "bg-white/[0.07]"
      )}
    >
      <CharacterThumb character={character} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{character.name}</span>
          {badge}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {t("referenceCount", { count: referenceCountTotal(character) })}
        </span>
      </span>
      <span className="flex shrink-0 items-center">
        {selected ? <IconCheck className="size-4 text-white" stroke={2} /> : trailing}
      </span>
    </button>
  );
}

/** Floating cast picker opened from the composer's character add slot. */
export function CastPicker({
  projectId,
  selectedCharacterIds,
  capReached,
  onPick,
  onClose,
}: {
  projectId: string;
  /** Character ids already attached to the card (rendered checked). */
  selectedCharacterIds: ReadonlySet<string>;
  /** Card already holds MAX_CHARACTERS_PER_GENERATION characters. */
  capReached: boolean;
  onPick: (character: CharacterSummary) => void;
  onClose: () => void;
}) {
  const t = useTranslations("canvasNodes.cast");
  const [tab, setTab] = useState<"cast" | "library">("cast");
  const queryClient = useQueryClient();

  const cast = useProjectCast(projectId, true);
  // Real_person characters granted to this project — generation-authorized via
  // their grant (no cast row), unioned into the Cast tab below.
  const granted = useGrantedCharacters(projectId, true);
  const castCharacterIds = new Set((cast.data ?? []).map((entry) => entry.characterId));

  // Cast rows = cast entries + granted real_person characters, deduped by
  // characterId (a character in both lists shows once). Granted rows carry the
  // person badge; cast real_person rows do too.
  const castRows = useMemo(() => {
    const rows: Array<{ key: string; character: CharacterSummary; realPerson: boolean }> = [];
    const seen = new Set<string>();
    for (const entry of cast.data ?? []) {
      if (seen.has(entry.characterId)) continue;
      seen.add(entry.characterId);
      rows.push({
        key: entry.id,
        character: entry.character,
        realPerson: entry.character.kind === "real_person",
      });
    }
    for (const character of granted.data ?? []) {
      if (seen.has(character.id)) continue;
      seen.add(character.id);
      rows.push({ key: `granted-${character.id}`, character, realPerson: true });
    }
    return rows;
  }, [cast.data, granted.data]);

  // Resolved lazily — only the library tab needs the project's workspace.
  const project = useQuery({
    queryKey: castPickerKeys.project(projectId),
    queryFn: () => getProject(projectId),
    enabled: tab === "library",
    staleTime: 60_000,
  });
  const workspaceId = project.data?.workspaceId;
  // Shared workspace-library query (same key as the Characters pages) —
  // disabled until the project's workspace resolves on first library-tab open.
  const library = useCharacters(workspaceId ?? null);

  // Cast-and-select in one click (idempotent server-side; duplicate cast
  // returns the existing entry).
  const castMutation = useMutation({
    mutationFn: (characterId: string) => castCharacter(projectId, characterId),
    onSuccess: (entry: CastEntry) => {
      void queryClient.invalidateQueries({ queryKey: castPickerKeys.cast(projectId) });
      onPick(entry.character);
      onClose();
    },
    onError: (error: unknown) => toast.error(errorText(error, t("castFailed"))),
  });

  const capReason = t("capReason", { max: MAX_CHARACTERS_PER_GENERATION });

  return (
    <div
      className={cn(
        "nodrag absolute bottom-full left-0 z-50 mb-2 flex max-h-[380px] w-[320px] origin-bottom flex-col overflow-hidden rounded-2xl bg-[oklch(0.24_0_0)] shadow-2xl shadow-black/60 backdrop-blur-2xl",
        "duration-150 animate-in fade-in-0 zoom-in-95"
      )}
    >
      {/* Tabs: project cast (default) vs workspace library. */}
      <div className="flex items-center gap-0.5 p-1.5">
        {(
          [
            { id: "cast", label: t("tabCast") },
            { id: "library", label: t("tabLibrary") },
          ] as const
        ).map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "flex h-7 flex-1 items-center justify-center rounded-full text-xs font-medium transition-colors",
              tab === id ? "bg-white/[0.1] text-white" : "text-white/60 hover:text-white"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mx-1 h-px bg-border" />

      <div className="nowheel min-h-0 flex-1 overflow-y-auto p-1">
        {tab === "cast" ? (
          // Skeleton only while the primary cast list loads; granted is
          // supplementary and its error never blocks the tab.
          cast.isPending ? (
            <RowSkeletons />
          ) : cast.isError ? (
            <p className="p-3 text-xs text-destructive">
              {errorText(cast.error, t("castLoadFailed"))}
            </p>
          ) : castRows.length === 0 ? (
            <div className="space-y-2 p-3">
              <p className="text-sm text-white/70">{t("castEmpty")}</p>
              <button
                type="button"
                onClick={() => setTab("library")}
                className="flex h-7 items-center gap-1.5 rounded-full bg-white/[0.08] px-3 text-xs font-medium text-white/80 transition-colors hover:bg-white/[0.12] hover:text-white"
              >
                <IconUserPlus className="size-3.5" stroke={1.8} />
                {t("addFromLibrary")}
              </button>
            </div>
          ) : (
            castRows.map((row) => {
              const selected = selectedCharacterIds.has(row.character.id);
              return (
                <CharacterRow
                  key={row.key}
                  character={row.character}
                  selected={selected}
                  disabled={selected || capReached}
                  disabledReason={selected ? undefined : capReason}
                  badge={row.realPerson ? <RealPersonBadge /> : undefined}
                  onClick={() => {
                    onPick(row.character);
                    onClose();
                  }}
                />
              );
            })
          )
        ) : project.isError ? (
          <p className="p-3 text-xs text-destructive">
            {errorText(project.error, t("workspaceResolveFailed"))}
          </p>
        ) : library.isError ? (
          <p className="p-3 text-xs text-destructive">
            {errorText(library.error, t("libraryLoadFailed"))}
          </p>
        ) : project.isPending || library.isPending ? (
          <RowSkeletons />
        ) : (library.data ?? []).length === 0 ? (
          <p className="p-3 text-sm text-white/70">{t("libraryEmpty")}</p>
        ) : (
          (library.data ?? []).map((character) => {
            const selected = selectedCharacterIds.has(character.id);
            const inCast = castCharacterIds.has(character.id);
            const casting = castMutation.isPending && castMutation.variables === character.id;
            return (
              <CharacterRow
                key={character.id}
                character={character}
                selected={selected}
                disabled={selected || capReached || castMutation.isPending}
                disabledReason={selected || castMutation.isPending ? undefined : capReason}
                trailing={
                  casting ? (
                    <IconLoader2 className="size-4 animate-spin text-white/70" stroke={1.8} />
                  ) : (
                    <IconUserPlus className="size-4 text-muted-foreground" stroke={1.8} />
                  )
                }
                onClick={() => {
                  if (inCast) {
                    onPick(character);
                    onClose();
                    return;
                  }
                  castMutation.mutate(character.id);
                }}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
