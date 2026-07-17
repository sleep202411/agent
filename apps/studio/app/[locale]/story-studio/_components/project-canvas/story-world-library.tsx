"use client";

import { IconBook2, IconBox, IconMapPin, IconUsers } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { InteractiveFilmDraftContent } from "@/lib/story-projects-api";
import { StoryCharacterLibrary } from "./story-character-library";
import { StoryTextCollectionEditor } from "./story-world-collections";

type FoundationField = "logline" | "synopsis" | "worldview";
type WorldTextField = "locations" | "props";
type Character = InteractiveFilmDraftContent["storyBible"]["characters"][number];

interface StoryWorldLibraryProps {
  content: InteractiveFilmDraftContent;
  locale: string;
  canEdit: boolean;
  onUpdateFoundation: (field: FoundationField, value: string) => void;
  onCreateCharacter: () => string | null;
  onUpdateCharacter: (characterId: string, patch: Partial<Omit<Character, "id">>) => void;
  onDeleteCharacter: (characterId: string) => void;
  onAddTextItem: (field: WorldTextField) => void;
  onUpdateTextItem: (field: WorldTextField, index: number, value: string) => void;
  onRemoveTextItem: (field: WorldTextField, index: number) => void;
}

export function StoryWorldLibrary({
  content,
  locale,
  canEdit,
  onUpdateFoundation,
  onCreateCharacter,
  onUpdateCharacter,
  onDeleteCharacter,
  onAddTextItem,
  onUpdateTextItem,
  onRemoveTextItem,
}: StoryWorldLibraryProps) {
  const t = useTranslations("storyStudio.canvas");
  return (
    <>
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.12em] text-white/34 uppercase">
            {t("world.eyebrow")}
          </p>
          <h2 className="mt-1 text-base font-semibold">{t("world.title")}</h2>
          <p className="mt-1 text-[11px] leading-5 text-white/38">{t("world.description")}</p>
        </div>
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/48">
          <IconBook2 className="size-4" />
        </span>
      </header>

      <div className="mt-4 grid grid-cols-3 gap-1.5">
        <WorldMetric label={t("metrics.characters")} value={content.storyBible.characters.length} />
        <WorldMetric label={t("metrics.locations")} value={content.storyBible.locations.length} />
        <WorldMetric label={t("metrics.props")} value={content.storyBible.props.length} />
      </div>

      <Tabs defaultValue="foundation" className="mt-5 gap-4">
        <TabsList className="grid h-auto! w-full grid-cols-2 gap-1 rounded-[16px] bg-white/[0.045] p-1">
          <WorldTab value="foundation" label={t("world.tabs.foundation")} icon={<IconBook2 />} />
          <WorldTab value="characters" label={t("world.tabs.characters")} icon={<IconUsers />} />
          <WorldTab value="locations" label={t("world.tabs.locations")} icon={<IconMapPin />} />
          <WorldTab value="props" label={t("world.tabs.props")} icon={<IconBox />} />
        </TabsList>

        <TabsContent value="foundation">
          <FoundationEditor
            content={content}
            canEdit={canEdit}
            onUpdateFoundation={onUpdateFoundation}
          />
        </TabsContent>
        <TabsContent value="characters">
          <StoryCharacterLibrary
            content={content}
            locale={locale}
            canEdit={canEdit}
            onCreate={onCreateCharacter}
            onUpdate={onUpdateCharacter}
            onDelete={onDeleteCharacter}
          />
        </TabsContent>
        <TabsContent value="locations">
          <StoryTextCollectionEditor
            kind="locations"
            values={content.storyBible.locations}
            canEdit={canEdit}
            onAdd={() => onAddTextItem("locations")}
            onUpdate={(index, value) => onUpdateTextItem("locations", index, value)}
            onRemove={(index) => onRemoveTextItem("locations", index)}
          />
        </TabsContent>
        <TabsContent value="props">
          <StoryTextCollectionEditor
            kind="props"
            values={content.storyBible.props}
            canEdit={canEdit}
            onAdd={() => onAddTextItem("props")}
            onUpdate={(index, value) => onUpdateTextItem("props", index, value)}
            onRemove={(index) => onRemoveTextItem("props", index)}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}

function WorldTab({ value, label, icon }: { value: string; label: string; icon: React.ReactNode }) {
  return (
    <TabsTrigger
      value={value}
      title={label}
      className="h-9 rounded-xl px-2 text-[10px] data-active:bg-white/[0.1]"
    >
      {icon}
      <span className="truncate">{label}</span>
    </TabsTrigger>
  );
}

function FoundationEditor({
  content,
  canEdit,
  onUpdateFoundation,
}: Pick<StoryWorldLibraryProps, "content" | "canEdit" | "onUpdateFoundation">) {
  const t = useTranslations("storyStudio.canvas");
  return (
    <div>
      <p className="text-[10px] leading-4 text-white/36">{t("foundation.description")}</p>
      <FoundationField
        label={t("foundation.logline")}
        placeholder={t("foundation.loglinePlaceholder")}
        value={content.storyBible.logline}
        rows={3}
        maxLength={1_000}
        disabled={!canEdit}
        onChange={(value) => onUpdateFoundation("logline", value)}
      />
      <FoundationField
        label={t("foundation.synopsis")}
        placeholder={t("foundation.synopsisPlaceholder")}
        value={content.storyBible.synopsis}
        rows={7}
        maxLength={20_000}
        disabled={!canEdit}
        onChange={(value) => onUpdateFoundation("synopsis", value)}
      />
      <FoundationField
        label={t("foundation.worldview")}
        placeholder={t("foundation.worldviewPlaceholder")}
        value={content.storyBible.worldview}
        rows={5}
        maxLength={20_000}
        disabled={!canEdit}
        onChange={(value) => onUpdateFoundation("worldview", value)}
      />
    </div>
  );
}

function FoundationField({
  label,
  placeholder,
  value,
  rows,
  maxLength,
  disabled,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  rows: number;
  maxLength: number;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mt-4 block">
      <span className="text-[10px] font-semibold text-white/42">{label}</span>
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        disabled={disabled}
        className="mt-2 resize-none bg-white/[0.055] text-xs leading-5"
      />
    </label>
  );
}

function WorldMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white/[0.045] px-2 py-2.5">
      <p className="truncate text-[8px] font-semibold text-white/30">{label}</p>
      <p className="mt-1 text-xs font-semibold tabular-nums text-white/68">{value}</p>
    </div>
  );
}
