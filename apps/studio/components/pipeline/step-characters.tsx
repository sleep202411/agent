"use client";

import { useState } from "react";
import { IconPlus, IconTrash, IconEdit, IconPhoto } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/src/lib/api";
import type { Character, Scene, Prop } from "@/src/store/slices/agentSlice";
import {
  addCharacter,
  removeCharacter,
  updateCharacter,
  addScene,
  removeScene,
  updateScene,
  addProp,
  removeProp,
} from "@/src/store/slices/agentSlice";
import { useAppSelector, useAppDispatch } from "@/src/store";
import { store } from "@/src/store";

type Tab = "characters" | "scenes" | "props";

// ─── Image Generation ────────────────────────────────

async function generateImage(prompt: string, imageSize: string = "square"): Promise<string> {
  const result = await api.post<{ url: string }>("/aurora/api/ai-models/generate", {
    data: {
      modelId: "flux-schnell",
      params: { prompt, image_size: imageSize },
    },
  });
  return result.url;
}

function buildCharacterPrompt(c: Character): string {
  return `Character portrait, ${c.appearance}, ${c.personality}, high quality, detailed, anime style`;
}

function buildScenePrompt(s: Scene): string {
  return `Environment concept art, ${s.name}, ${s.description}, cinematic lighting, detailed background, anime style`;
}

// ─── Main Component ──────────────────────────────────

export function StepCharacters() {
  const t = useTranslations("pipeline");
  const [activeTab, setActiveTab] = useState<Tab>("characters");
  const dispatch = useAppDispatch();
  const stepStatuses = useAppSelector((s) => s.agent.stepStatuses);
  const characters = useAppSelector((s) => s.agent.characters);
  const scenes = useAppSelector((s) => s.agent.scenes);
  const props = useAppSelector((s) => s.agent.props);

  const isGenerating = stepStatuses[2] === "generating";

  if (isGenerating && characters.length === 0) {
    return <CharactersSkeleton />;
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "characters", label: t("allCharacters"), count: characters.length },
    { key: "scenes", label: t("allScenes"), count: scenes.length },
    { key: "props", label: "道具", count: props.length },
  ];

  const handleAddCharacter = () => {
    dispatch(
      addCharacter({
        id: crypto.randomUUID(),
        name: "",
        role: "supporting",
        personality: "",
        appearance: "",
        imageStatus: "pending",
      })
    );
  };

  const handleAddScene = () => {
    dispatch(
      addScene({
        id: crypto.randomUUID(),
        name: "",
        description: "",
        imageStatus: "pending",
      })
    );
  };

  const handleAddProp = () => {
    dispatch(
      addProp({
        id: crypto.randomUUID(),
        name: "",
        description: "",
      })
    );
  };

  return (
    <div className="w-full">
      {/* Tabs */}
      <div className="mb-6 flex gap-1 border-b border-border">
        {tabs.map(({ key, label, count }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-colors",
              activeTab === key
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {label} {count}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === "characters" && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
          {characters.map((character) => (
            <CharacterCard
              key={character.id}
              character={character}
              onRemove={() => dispatch(removeCharacter(character.id))}
            />
          ))}
          <AddCard label={t("newCharacter")} onClick={handleAddCharacter} />
        </div>
      )}

      {activeTab === "scenes" && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
          {scenes.map((scene) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              onRemove={() => dispatch(removeScene(scene.id))}
            />
          ))}
          <AddCard label={t("newScene")} onClick={handleAddScene} />
        </div>
      )}

      {activeTab === "props" && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
          {props.map((prop) => (
            <PropCard key={prop.id} prop={prop} onRemove={() => dispatch(removeProp(prop.id))} />
          ))}
          <AddCard label={t("newProp")} onClick={handleAddProp} />
        </div>
      )}
    </div>
  );
}

// ─── Batch Generate (exported for footer button) ─────

export async function batchGenerateImages(
  characters: Character[],
  scenes: Scene[],
  onUpdateCharacter: (id: string, updates: Partial<Character>) => void,
  onUpdateScene: (id: string, updates: Partial<Scene>) => void
) {
  const tasks: Promise<void>[] = [];

  for (const c of characters) {
    if (c.imageUrl || !c.appearance) continue;
    tasks.push(
      (async () => {
        onUpdateCharacter(c.id, { imageStatus: "generating" });
        try {
          const url = await generateImage(buildCharacterPrompt(c));
          onUpdateCharacter(c.id, { imageUrl: url, imageStatus: "done" });
        } catch {
          onUpdateCharacter(c.id, { imageStatus: "pending" });
        }
      })()
    );
  }

  for (const s of scenes) {
    if (s.imageUrl || !s.description) continue;
    tasks.push(
      (async () => {
        onUpdateScene(s.id, { imageStatus: "generating" });
        try {
          const url = await generateImage(buildScenePrompt(s), "landscape_16_9");
          onUpdateScene(s.id, { imageUrl: url, imageStatus: "done" });
        } catch {
          onUpdateScene(s.id, { imageStatus: "pending" });
        }
      })()
    );
  }

  await Promise.allSettled(tasks);

  // Persist updated characters/scenes (with imageUrls) to step result
  const agentState = store.getState().agent;
  const taskId = agentState.taskId;
  if (taskId) {
    api
      .put(`/api/tasks/${taskId}/steps/2`, {
        data: {
          stepLabel: "提取角色与场景",
          result: {
            characters: agentState.characters,
            scenes: agentState.scenes,
            props: agentState.props,
          },
        },
      })
      .catch((err) => console.warn("[batchGenerateImages] Failed to persist step result:", err));
  }
}

// ─── Character Card ─────────────────────────────────────

function CharacterCard({ character, onRemove }: { character: Character; onRemove: () => void }) {
  const t = useTranslations("pipeline");
  return (
    <div className="group relative rounded-lg border border-border bg-card overflow-hidden">
      {/* Role badge */}
      {character.role === "main" && (
        <span className="absolute left-2 top-2 z-10 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
          主角
        </span>
      )}

      {/* Image area */}
      <div className="flex aspect-[3/4] items-center justify-center bg-muted/30">
        {character.imageUrl ? (
          <img src={character.imageUrl} alt={character.name} className="size-full object-cover" />
        ) : character.imageStatus === "generating" ? (
          <Spinner className="size-5 text-muted-foreground" />
        ) : (
          <IconPhoto className="size-8 text-muted-foreground/20" />
        )}
      </div>

      {/* Info — absolute, overlaid at bottom */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-2 pt-6">
        <p className="text-xs font-medium text-white truncate">{character.name || t("unnamed")}</p>
        <p className="text-[11px] text-white/60 truncate">
          {character.personality || t("pendingDescription")}
        </p>
      </div>

      {/* Actions overlay */}
      <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button variant="ghost" color="muted" size="icon-xs" className="bg-background/80">
          <IconEdit className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          color="muted"
          size="icon-xs"
          className="bg-background/80 hover:text-destructive"
          onClick={onRemove}
        >
          <IconTrash className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Scene Card ─────────────────────────────────────────

function SceneCard({ scene, onRemove }: { scene: Scene; onRemove: () => void }) {
  const t = useTranslations("pipeline");
  return (
    <div className="group relative rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex aspect-[3/4] items-center justify-center bg-muted/30">
        {scene.imageUrl ? (
          <img src={scene.imageUrl} alt={scene.name} className="size-full object-cover" />
        ) : scene.imageStatus === "generating" ? (
          <Spinner className="size-5 text-muted-foreground" />
        ) : (
          <IconPhoto className="size-8 text-muted-foreground/20" />
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-2 pt-6">
        <p className="text-xs font-medium text-white truncate">{scene.name || t("unnamed")}</p>
        <p className="text-[11px] text-white/60 truncate">
          {scene.description || t("pendingDescription")}
        </p>
      </div>
      <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button variant="ghost" color="muted" size="icon-xs" className="bg-background/80">
          <IconEdit className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          color="muted"
          size="icon-xs"
          className="bg-background/80 hover:text-destructive"
          onClick={onRemove}
        >
          <IconTrash className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Prop Card ──────────────────────────────────────────

function PropCard({ prop, onRemove }: { prop: Prop; onRemove: () => void }) {
  const t = useTranslations("pipeline");
  return (
    <div className="group relative rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex aspect-[3/4] items-center justify-center bg-muted/30">
        <IconPhoto className="size-8 text-muted-foreground/20" />
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-2 pt-6">
        <p className="text-xs font-medium text-white truncate">{prop.name || t("unnamed")}</p>
        <p className="text-[11px] text-white/60 truncate">
          {prop.description || t("pendingDescription")}
        </p>
      </div>
      <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button variant="ghost" color="muted" size="icon-xs" className="bg-background/80">
          <IconEdit className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          color="muted"
          size="icon-xs"
          className="bg-background/80 hover:text-destructive"
          onClick={onRemove}
        >
          <IconTrash className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Add Card ───────────────────────────────────────────

function AddCard({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
    >
      <IconPlus className="size-6" />
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

// ─── Skeleton ───────────────────────────────────────────

function CharactersSkeleton() {
  const t = useTranslations("pipeline");
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Spinner className="size-5" />
        <span className="text-sm">{t("generatingCharacters")}</span>
      </div>
    </div>
  );
}
