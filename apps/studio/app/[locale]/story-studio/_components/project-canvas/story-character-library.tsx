"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  IconArrowLeft,
  IconChevronRight,
  IconPlus,
  IconTrash,
  IconUser,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { InteractiveFilmDraftContent } from "@/lib/story-projects-api";
import { cn } from "@/lib/utils";
import { countCharacterReferences } from "./story-world-mutations";

type StoryCharacter = InteractiveFilmDraftContent["storyBible"]["characters"][number];
type StoryCharacterPatch = Partial<Omit<StoryCharacter, "id">>;

const MAX_CHARACTERS = 100;
const MAX_LOCALIZED_NAME_LENGTH = 4_000;
const MAX_ROLE_LENGTH = 160;
const MAX_SUMMARY_LENGTH = 4_000;
const MAX_CONTINUITY_RULES = 50;
const MAX_CONTINUITY_RULE_LENGTH = 1_000;

export interface StoryCharacterLibraryProps {
  content: InteractiveFilmDraftContent;
  locale: string;
  canEdit: boolean;
  onCreate: () => string | null;
  onUpdate: (id: string, patch: StoryCharacterPatch) => void;
  onDelete: (id: string) => void;
}

export function StoryCharacterLibrary({
  content,
  locale,
  canEdit,
  onCreate,
  onUpdate,
  onDelete,
}: StoryCharacterLibraryProps) {
  const t = useTranslations("storyStudio.canvas.world.characters");
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const characters = content.storyBible.characters;
  const selectedCharacter =
    characters.find((character) => character.id === selectedCharacterId) ?? null;
  const referenceCounts = useMemo(
    () =>
      new Map(
        characters.map((character) => [
          character.id,
          countCharacterReferences(content, character.id),
        ])
      ),
    [characters, content]
  );

  const createCharacter = () => {
    const createdId = onCreate();
    if (createdId) setSelectedCharacterId(createdId);
  };

  if (!selectedCharacter) {
    return (
      <section aria-labelledby="story-character-library-title">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.12em] text-white/34 uppercase">
              {t("eyebrow")}
            </p>
            <h2 id="story-character-library-title" className="mt-1 text-base font-semibold">
              {t("title")}
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-white/38">{t("description")}</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!canEdit || characters.length >= MAX_CHARACTERS}
            onClick={createCharacter}
          >
            <IconPlus />
            {t("create")}
          </Button>
        </div>

        {characters.length === 0 ? (
          <div className="mt-5 rounded-[20px] bg-white/[0.04] px-5 py-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
            <span className="mx-auto grid size-10 place-items-center rounded-2xl bg-white/[0.06] text-white/38">
              <IconUser className="size-5" />
            </span>
            <p className="mt-3 text-xs font-semibold text-white/66">{t("emptyTitle")}</p>
            <p className="mx-auto mt-1 max-w-64 text-[10px] leading-4 text-white/34">
              {t("emptyDescription")}
            </p>
          </div>
        ) : (
          <div className="mt-5 space-y-2">
            {characters.map((character) => {
              const references = referenceCounts.get(character.id) ?? 0;
              return (
                <button
                  key={character.id}
                  type="button"
                  onClick={() => setSelectedCharacterId(character.id)}
                  className="flex w-full items-center gap-3 rounded-[16px] bg-white/[0.045] px-3 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition hover:bg-white/[0.075] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/24"
                  aria-label={t("openCharacter", {
                    name: localizedCharacterName(character, locale),
                  })}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.065] text-white/54">
                    <IconUser className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-white/76">
                      {localizedCharacterName(character, locale)}
                    </span>
                    <span className="mt-1 block truncate text-[9px] text-white/34">
                      {character.role || t("roleEmpty")} · {character.id}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-white/[0.055] px-2 py-1 text-[9px] tabular-nums text-white/38">
                    {t("referenceCount", { count: references })}
                  </span>
                  <IconChevronRight className="size-4 shrink-0 text-white/28" />
                </button>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  const referenceCount = referenceCounts.get(selectedCharacter.id) ?? 0;
  const deletionBlocked = referenceCount > 0;

  return (
    <section aria-labelledby="story-character-detail-title">
      <button
        type="button"
        onClick={() => setSelectedCharacterId(null)}
        className="inline-flex h-8 items-center gap-2 rounded-xl bg-white/[0.05] px-3 text-[10px] font-semibold text-white/54 transition hover:bg-white/[0.09] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/24"
      >
        <IconArrowLeft className="size-3.5" />
        {t("backToList")}
      </button>

      <div className="mt-4 flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/[0.065] text-white/58">
          <IconUser className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-[0.12em] text-white/34 uppercase">
            {t("detailEyebrow")}
          </p>
          <h2 id="story-character-detail-title" className="mt-1 truncate text-base font-semibold">
            {localizedCharacterName(selectedCharacter, locale)}
          </h2>
          <p className="mt-1 text-[9px] text-white/32">
            {t("referenceCount", { count: referenceCount })}
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <label className="block">
          <FieldLabel>{t("stableId")}</FieldLabel>
          <Input
            value={selectedCharacter.id}
            readOnly
            aria-readonly="true"
            className="mt-1.5 h-9 rounded-xl bg-white/[0.04] px-3 font-mono text-white/42"
          />
        </label>

        <label className="block">
          <FieldLabel>{t("name", { locale })}</FieldLabel>
          <Input
            value={selectedCharacter.name[locale] ?? ""}
            maxLength={MAX_LOCALIZED_NAME_LENGTH}
            disabled={!canEdit}
            placeholder={t("namePlaceholder")}
            onChange={(event) =>
              onUpdate(selectedCharacter.id, {
                name: { ...selectedCharacter.name, [locale]: event.target.value },
              })
            }
            className="mt-1.5 h-9 rounded-xl bg-white/[0.055] px-3"
          />
        </label>

        <label className="block">
          <FieldLabel>{t("role")}</FieldLabel>
          <Input
            value={selectedCharacter.role}
            maxLength={MAX_ROLE_LENGTH}
            disabled={!canEdit}
            placeholder={t("rolePlaceholder")}
            onChange={(event) => onUpdate(selectedCharacter.id, { role: event.target.value })}
            className="mt-1.5 h-9 rounded-xl bg-white/[0.055] px-3"
          />
        </label>

        <label className="block">
          <FieldLabel>{t("summary")}</FieldLabel>
          <Textarea
            value={selectedCharacter.summary}
            maxLength={MAX_SUMMARY_LENGTH}
            disabled={!canEdit}
            rows={5}
            placeholder={t("summaryPlaceholder")}
            onChange={(event) => onUpdate(selectedCharacter.id, { summary: event.target.value })}
            className="mt-1.5 resize-none rounded-xl bg-white/[0.055] text-xs leading-5"
          />
        </label>

        <div>
          <FieldLabel>{t("playable")}</FieldLabel>
          <button
            type="button"
            role="switch"
            aria-checked={selectedCharacter.playable}
            aria-label={t("playableToggle")}
            disabled={!canEdit}
            onClick={() =>
              onUpdate(selectedCharacter.id, { playable: !selectedCharacter.playable })
            }
            className="mt-1.5 flex h-10 w-full items-center justify-between rounded-xl bg-white/[0.055] px-3 text-xs font-semibold text-white/62 transition hover:bg-white/[0.09] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/24"
          >
            <span>{t(selectedCharacter.playable ? "playableOn" : "playableOff")}</span>
            <span
              aria-hidden="true"
              className={cn(
                "relative h-5 w-9 rounded-full bg-white/[0.12] transition",
                selectedCharacter.playable && "bg-white/[0.32]"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 left-0.5 size-4 rounded-full bg-white/64 shadow-sm transition-transform",
                  selectedCharacter.playable && "translate-x-4 bg-white"
                )}
              />
            </span>
          </button>
        </div>

        <ContinuityRulesEditor
          character={selectedCharacter}
          canEdit={canEdit}
          onUpdate={(continuityRules) => onUpdate(selectedCharacter.id, { continuityRules })}
        />
      </div>

      <div className="mt-6 rounded-[16px] bg-white/[0.04] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <Button
          type="button"
          variant="destructive"
          disabled={!canEdit || deletionBlocked}
          onClick={() => setDeleteOpen(true)}
          className="w-full"
        >
          <IconTrash />
          {t("delete")}
        </Button>
        {deletionBlocked ? (
          <p className="mt-2 text-[9px] leading-4 text-white/38">
            {t("deleteBlocked", { count: referenceCount })}
          </p>
        ) : (
          <p className="mt-2 text-[9px] leading-4 text-white/30">{t("deleteAvailable")}</p>
        )}
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="rounded-[22px] bg-[oklch(0.22_0_0/0.96)] p-5 shadow-[0_28px_100px_rgba(0,0,0,0.58)] backdrop-blur-[40px]">
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteDescription", {
                name: localizedCharacterName(selectedCharacter, locale),
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">{t("cancel")}</Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={deletionBlocked}
              onClick={() => {
                if (deletionBlocked) return;
                onDelete(selectedCharacter.id);
                setDeleteOpen(false);
                setSelectedCharacterId(null);
              }}
            >
              <IconTrash />
              {t("confirmDelete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ContinuityRulesEditor({
  character,
  canEdit,
  onUpdate,
}: {
  character: StoryCharacter;
  canEdit: boolean;
  onUpdate: (rules: string[]) => void;
}) {
  const t = useTranslations("storyStudio.canvas.world.characters");
  const [newRule, setNewRule] = useState("");
  const normalizedNewRule = newRule.trim();
  const canAdd =
    canEdit &&
    character.continuityRules.length < MAX_CONTINUITY_RULES &&
    normalizedNewRule.length > 0;

  const addRule = () => {
    if (!canAdd) return;
    onUpdate([...character.continuityRules, normalizedNewRule]);
    setNewRule("");
  };

  return (
    <section aria-labelledby="story-character-rules-title">
      <div className="flex items-center justify-between gap-3">
        <FieldLabel id="story-character-rules-title">{t("continuityRules")}</FieldLabel>
        <span className="rounded-full bg-white/[0.055] px-2 py-1 text-[9px] tabular-nums text-white/34">
          {character.continuityRules.length}/{MAX_CONTINUITY_RULES}
        </span>
      </div>

      {character.continuityRules.length === 0 ? (
        <p className="mt-2 rounded-xl bg-white/[0.035] px-3 py-2.5 text-[10px] leading-4 text-white/32">
          {t("noContinuityRules")}
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {character.continuityRules.map((rule, index) => (
            <ContinuityRuleRow
              key={`${index}:${rule}`}
              rule={rule}
              index={index}
              canEdit={canEdit}
              onCommit={(nextRule) =>
                onUpdate(
                  character.continuityRules.map((candidate, candidateIndex) =>
                    candidateIndex === index ? nextRule : candidate
                  )
                )
              }
              onRemove={() =>
                onUpdate(
                  character.continuityRules.filter(
                    (_candidate, candidateIndex) => candidateIndex !== index
                  )
                )
              }
            />
          ))}
        </div>
      )}

      {canEdit && character.continuityRules.length < MAX_CONTINUITY_RULES ? (
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-white/[0.035] p-2">
          <Input
            value={newRule}
            maxLength={MAX_CONTINUITY_RULE_LENGTH}
            placeholder={t("newRulePlaceholder")}
            aria-label={t("newRuleLabel")}
            onChange={(event) => setNewRule(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addRule();
              }
              if (event.key === "Escape") setNewRule("");
            }}
            className="h-9 min-w-0 flex-1 rounded-xl bg-black/18 px-3"
          />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            disabled={!canAdd}
            onClick={addRule}
            aria-label={t("addRule")}
          >
            <IconPlus />
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function ContinuityRuleRow({
  rule,
  index,
  canEdit,
  onCommit,
  onRemove,
}: {
  rule: string;
  index: number;
  canEdit: boolean;
  onCommit: (rule: string) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("storyStudio.canvas.world.characters");
  const [draft, setDraft] = useState(rule);

  const commit = () => {
    const normalized = draft.trim();
    if (!normalized) {
      setDraft(rule);
      return;
    }
    if (normalized !== rule) onCommit(normalized);
  };

  return (
    <div className="flex items-center gap-2 rounded-xl bg-white/[0.045] p-2">
      <Input
        value={draft}
        maxLength={MAX_CONTINUITY_RULE_LENGTH}
        disabled={!canEdit}
        aria-label={t("ruleLabel", { number: index + 1 })}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(rule);
            event.currentTarget.blur();
          }
        }}
        className="h-9 min-w-0 flex-1 rounded-xl bg-black/18 px-3"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={!canEdit}
        onClick={onRemove}
        aria-label={t("removeRule", { number: index + 1 })}
        title={t("removeRule", { number: index + 1 })}
        className="text-white/34 hover:text-destructive"
      >
        <IconTrash />
      </Button>
    </div>
  );
}

function FieldLabel({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span id={id} className="text-[10px] font-semibold text-white/42">
      {children}
    </span>
  );
}

function localizedCharacterName(character: StoryCharacter, locale: string): string {
  const localized = character.name[locale]?.trim();
  if (localized) return localized;
  return (
    Object.values(character.name)
      .find((value) => value.trim())
      ?.trim() || character.id
  );
}
