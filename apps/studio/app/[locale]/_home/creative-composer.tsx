"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  IconArrowUp,
  IconLayoutGrid,
  IconLoader2,
  IconRefresh,
  type Icon,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAuth } from "@/app/_components/auth-provider";
import { useWorkspace } from "@/app/_components/workspace-context";
import { useRouter } from "@/i18n/navigation";
import { createProject } from "@/lib/collab/projects-api";
import {
  useComposerDraft,
  useComposerDraftStore,
} from "../(studio)/_components/generation/use-composer-draft";
import { StudioComposer } from "../(studio)/_components/generation/studio-composer";
import { useImageGeneration } from "../(studio)/_components/generation/use-image-generation";
import { useVideoGeneration } from "../(studio)/_components/generation/use-video-generation";
import { G, Glyph } from "../_pollo/glyphs";

type Modality = "image" | "video" | "project";

const TOGGLE: { id: Modality; labelKey: string; svg?: string; Icon?: Icon }[] = [
  { id: "image", labelKey: "composer.modes.image", svg: G.image },
  { id: "video", labelKey: "composer.modes.video", svg: G.video },
  { id: "project", labelKey: "composer.modes.project", Icon: IconLayoutGrid },
];

const SUGGESTION_GROUPS: Array<Array<{ key: string; modality: Modality }>> = [
  [
    { key: "socialCarousel", modality: "image" },
    { key: "etsyMockup", modality: "image" },
    { key: "ugcAdVideo", modality: "video" },
  ],
  [
    { key: "facelessShort", modality: "video" },
    { key: "musicVideo", modality: "video" },
    { key: "podcastCover", modality: "image" },
  ],
  [
    { key: "brandKit", modality: "project" },
    { key: "interiorMoodboard", modality: "image" },
    { key: "campaignStoryboard", modality: "project" },
  ],
];

/** Home uses the same generation contract and controls as the dedicated tools. */
export function CreativeComposer() {
  const th = useTranslations("home");
  const [modality, setModality] = useState<Modality>("image");
  const [suggestionGroup, setSuggestionGroup] = useState(0);
  const [suggestion, setSuggestion] = useState<{ id: number; text: string } | null>(null);
  const sequence = useRef(0);
  const imageDraft = useComposerDraft("image");
  const videoDraft = useComposerDraft("video");
  const { prompt: projectPrompt, setPrompt: setProjectPrompt } = useComposerDraft("project");
  const currentPrompt =
    modality === "image"
      ? imageDraft.prompt
      : modality === "video"
        ? videoDraft.prompt
        : projectPrompt;
  const changeModality = (next: Modality) => {
    if (next === "image") imageDraft.setPrompt(currentPrompt);
    else if (next === "video") videoDraft.setPrompt(currentPrompt);
    else setProjectPrompt(currentPrompt);
    setSuggestion(null);
    setModality(next);
  };
  return (
    <div className="mx-auto w-full max-w-[1120px]">
      <ToggleGroup
        type="single"
        value={modality}
        onValueChange={(value) => {
          if (value === "image" || value === "video" || value === "project") {
            changeModality(value);
          }
        }}
        aria-label={th("composer.generationTypeAria")}
        className="mb-3 inline-flex rounded-xl bg-white/[0.03] p-1"
      >
        {TOGGLE.map((entry) => (
          <ToggleGroupItem
            key={entry.id}
            value={entry.id}
            aria-label={th(entry.labelKey)}
            className="gap-1.5 rounded-lg px-3 text-sm text-white/55 data-[state=on]:bg-white/10 data-[state=on]:text-white"
          >
            {entry.svg ? (
              <Glyph svg={entry.svg} size={15} fill="currentColor" />
            ) : entry.Icon ? (
              <entry.Icon className="size-4" />
            ) : null}
            {th(entry.labelKey)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {modality === "project" ? (
        <ProjectComposer
          suggestion={suggestion}
          prompt={projectPrompt}
          setPrompt={setProjectPrompt}
        />
      ) : modality === "image" ? (
        <HomeImageComposer suggestion={suggestion} />
      ) : (
        <HomeVideoComposer suggestion={suggestion} />
      )}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
        {SUGGESTION_GROUPS[suggestionGroup].map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => {
              setModality(entry.modality);
              setSuggestion({
                id: ++sequence.current,
                text: th(`composer.suggestions.${entry.key}.prompt`),
              });
            }}
            className="max-w-[240px] truncate rounded-xl px-3 py-2 text-sm text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.11)] hover:bg-white/[0.07]"
          >
            {th(`composer.suggestions.${entry.key}.label`)}
          </button>
        ))}
        <button
          type="button"
          aria-label={th("composer.shuffleAria")}
          onClick={() => setSuggestionGroup((group) => (group + 1) % SUGGESTION_GROUPS.length)}
          className="grid size-8 place-items-center rounded-full text-white hover:bg-white/[0.07]"
        >
          <IconRefresh className="size-[18px]" />
        </button>
      </div>
    </div>
  );
}

type SuggestionProps = { suggestion: { id: number; text: string } | null };
function useSuggestion(
  suggestion: SuggestionProps["suggestion"],
  setPrompt: (text: string) => void
) {
  useLayoutEffect(() => {
    if (suggestion) setPrompt(suggestion.text);
  }, [suggestion, setPrompt]);
}
function HomeImageComposer({ suggestion }: SuggestionProps) {
  const gen = useImageGeneration();
  useSuggestion(suggestion, gen.setPrompt);
  return <HomeGenerationComposer gen={gen} modality="image" error={gen.submitError} />;
}
function HomeVideoComposer({ suggestion }: SuggestionProps) {
  const gen = useVideoGeneration();
  useSuggestion(suggestion, gen.setPrompt);
  return <HomeGenerationComposer gen={gen} modality="video" error={gen.error} />;
}
function HomeGenerationComposer({
  gen,
  modality,
  error,
}: {
  gen: ReturnType<typeof useImageGeneration> | ReturnType<typeof useVideoGeneration>;
  modality: "image" | "video";
  error: string | null;
}) {
  const router = useRouter();
  const { user, requireAuth } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const [loginDraft, setLoginDraft] = useState<{
    prompt: string;
    modelId?: string;
    settings: typeof gen.settings;
    mode?: string;
    references: typeof gen.activeUploads;
    sourceKey: string;
  } | null>(null);
  const claimedLogin = useRef<object | null>(null);
  const hydratedLogin = useRef<{ request: object; scope: string } | null>(null);
  const runClaim = useRef<object | null>(null);
  useLayoutEffect(() => {
    runClaim.current = null;
    return () => {
      runClaim.current = null;
    };
  }, [user?.id, activeWorkspace?.id]);
  const gate = useRef<object | null>(null);
  const signature = JSON.stringify([
    gen.prompt,
    gen.model?.id,
    gen.settings,
    gen.mode,
    gen.activeUploads,
  ]);
  useLayoutEffect(() => {
    gate.current = {};
    return () => {
      gate.current = null;
    };
  }, [signature]);
  const run = () => {
    if (runClaim.current) return;
    const claim = {};
    runClaim.current = claim;
    void gen.submit().then((result) => {
      if (runClaim.current !== claim) return;
      if (result.ok) router.push(modality === "image" ? "/images" : "/video");
      else runClaim.current = null;
    });
  };
  const requestSubmit = () => {
    const operation = gate.current;
    let resumed = false;
    requireAuth(() => {
      if (!operation || gate.current !== operation || resumed) return;
      resumed = true;
      if (user) run();
      else
        setLoginDraft({
          prompt: gen.prompt,
          modelId: gen.model?.id,
          settings: gen.settings,
          mode: gen.mode,
          sourceKey: JSON.stringify([null, activeWorkspace?.id ?? null, modality]),
          references: gen.activeUploads
            .filter((item) => item.url && !item.uploading && !item.error)
            .map((item) => ({ ...item, previewUrl: item.url! })),
        });
    });
  };
  // Login resumes before the account query refreshes. Wait for its workspace,
  // then restore this explicitly submitted guest draft into the signed-in scope.
  useEffect(() => {
    if (!loginDraft || !user || !activeWorkspace || claimedLogin.current === loginDraft) return;
    const key = JSON.stringify([user.id, activeWorkspace.id, modality]);
    const store = useComposerDraftStore.getState();
    if (hydratedLogin.current?.request !== loginDraft) {
      // A guest edit made while the session was loading cancels the old intent.
      if (store.drafts[loginDraft.sourceKey]?.prompt !== loginDraft.prompt) {
        claimedLogin.current = loginDraft;
        return;
      }
      hydratedLogin.current = { request: loginDraft, scope: key };
      store.update(key, "prompt", loginDraft.prompt);
      if (loginDraft.modelId) store.update(key, "modelId", loginDraft.modelId);
      store.update(key, "settings", loginDraft.settings);
      store.update(key, "mode", loginDraft.mode);
      store.update(key, "references", loginDraft.references);
      return;
    }
    if (hydratedLogin.current.scope !== key) {
      claimedLogin.current = loginDraft;
      return;
    }
    if (!gen.canSubmit) return;
    claimedLogin.current = loginDraft;
    run();
  });
  return (
    <StudioComposer
      submissionRecovery={gen.feed.submissionRecovery}
      docked={false}
      submitOnEnter
      modality={modality}
      catalog={gen.catalog}
      prompt={gen.prompt}
      onPromptChange={gen.setPrompt}
      model={gen.model}
      onSelectModel={gen.onSelectModel}
      settings={gen.settings}
      onSettingsChange={gen.setSettings}
      mode={gen.mode}
      modes={gen.modes}
      onSelectMode={gen.setMode}
      referenceFields={gen.referenceFields}
      referenceItems={gen.activeUploads}
      onAddReferences={(field, files) => gen.uploads.addFiles(field.field, field.kind, files)}
      onRemoveReference={gen.uploads.remove}
      cost={gen.cost}
      canSubmit={gen.canSubmit}
      submitting={gen.submitting}
      error={error}
      validationIssues={gen.validationIssues}
      onDismissValidation={gen.clearValidation}
      onRequestSubmit={requestSubmit}
      onSubmit={run}
    />
  );
}

function ProjectComposer({
  suggestion,
  prompt,
  setPrompt,
}: SuggestionProps & { prompt: string; setPrompt: (value: string) => void }) {
  const th = useTranslations("home");
  const tp = useTranslations("projects");
  const ts = useTranslations("project.sections");
  const { user, requireAuth } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  useSuggestion(suggestion, setPrompt);
  const [requested, setRequested] = useState<{
    prompt: string;
    userId: string | number | null;
    workspaceId: string | null;
  } | null>(null);
  const active = useRef<object | null>(null);
  useLayoutEffect(() => {
    active.current = {};
    return () => {
      active.current = null;
    };
  }, [prompt, user?.id, activeWorkspace?.id]);
  const pending = useRef(false);
  const submit = () => {
    const scope = active.current;
    if (!prompt.trim() || pending.current) return;
    requireAuth(() => {
      if (!scope || active.current !== scope || pending.current) return;
      setRequested({
        prompt: prompt.trim(),
        userId: user?.id ?? null,
        workspaceId: activeWorkspace?.id ?? null,
      });
    });
  };
  useEffect(() => {
    if (!requested || !user || !activeWorkspace || pending.current) return;
    if (requested.userId == null && prompt !== requested.prompt) {
      const sourceKey = JSON.stringify([null, requested.workspaceId, "project"]);
      if (useComposerDraftStore.getState().drafts[sourceKey]?.prompt.trim() !== requested.prompt)
        return;
      setPrompt(requested.prompt);
      return;
    }
    if (
      requested.prompt !== prompt.trim() ||
      (requested.userId != null && requested.userId !== user.id) ||
      (requested.workspaceId != null && requested.workspaceId !== activeWorkspace.id)
    )
      return;
    const scope = active.current;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || pending.current) return;
      pending.current = true;
      setCreating(true);
      let navigated = false;
      void createProject(activeWorkspace.id, {
        name: tp("untitledCanvas"),
        initialSectionTitle: ts("defaultTitle"),
        description: requested.prompt,
      })
        .then((project) => {
          if (active.current === scope) {
            navigated = true;
            router.push(
              `/project/${project.id}/canvas?prompt=${encodeURIComponent(requested.prompt)}`
            );
          }
        })
        .catch((error: unknown) => {
          if (active.current === scope)
            toast.error(error instanceof Error ? error.message : tp("createCanvasFailed"));
        })
        .finally(() => {
          pending.current = navigated;
          setCreating(navigated);
          setRequested(null);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [requested, user, activeWorkspace, prompt, setPrompt, router, tp, ts]);
  return (
    <div className="rounded-3xl bg-[oklch(0.22)] p-4">
      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        aria-label={th("composer.promptAria")}
        placeholder={th("composer.placeholders.campaign")}
        rows={3}
        className="w-full resize-none bg-transparent text-sm outline-none"
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.repeat &&
            !event.nativeEvent.isComposing &&
            event.nativeEvent.keyCode !== 229
          ) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={!prompt.trim() || creating || Boolean(user && !activeWorkspace)}
          aria-label={th("composer.createAria")}
          aria-busy={creating}
          className="grid size-9 place-items-center rounded-full bg-primary text-white disabled:opacity-40"
        >
          {creating ? (
            <IconLoader2 className="size-4 animate-spin" />
          ) : (
            <IconArrowUp className="size-4" />
          )}
        </button>
      </div>
    </div>
  );
}
