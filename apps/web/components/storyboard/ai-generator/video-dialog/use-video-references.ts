import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import { useAppDispatch } from "@/src/store";
import {
  setVideoReferences,
  updateVideoForm,
  type VideoReferences,
} from "@/src/store/slices/projectSlice";
import type { AiModel } from "@/components/ui/schema-field/schema";
import {
  buildReferenceMap,
  extractMentionsFromHtml,
  removeMentionsByUrls,
  detectMediaType,
} from "@/components/storyboard/editor/build-reference-map";
import type { ReferenceMap } from "@/components/storyboard/editor/reference-map-context";
import {
  dedupeRefs,
  ossUrl,
  toReferenceAssets,
  type MultiRefType,
  type PickerTarget,
  type ReferenceAsset,
} from "./video-types";

interface UseVideoReferencesOptions {
  open: boolean;
  key: string;
  prompt: string;
  defaultPrompt?: string;
  defaultReferenceImage?: string;
  references: VideoReferences;
  currentModel: AiModel | undefined;
  modeModels: AiModel[];
  activeMode: string;
}

export function useVideoReferences({
  open,
  key,
  prompt,
  defaultPrompt,
  defaultReferenceImage,
  references,
  currentModel,
  modeModels,
  activeMode,
}: UseVideoReferencesOptions) {
  const dispatch = useAppDispatch();
  const t = useTranslations("storyboard");

  // ─── Limits from model ──
  const maxImages = currentModel?.maxImages ?? 3;
  const maxVideos = currentModel?.maxVideos ?? 0;
  const maxAudios = currentModel?.maxAudios ?? 0;

  const {
    referenceImages,
    firstFrames,
    lastFrames,
    multiRefImages,
    repaintRefVideos,
    repaintRefImage,
    localEditRefVideo,
    localEditMaskImage,
    localEditRefImage,
    extendFirstClip,
    extendLastClip,
    extendFirstFrame,
    extendLastFrame,
    outpaintingRefVideo,
  } = references;

  const refIsFull = referenceImages.length >= maxImages;

  // ─── Clean prompt when refs are removed ──
  const cleanPromptOnRefRemoval = useCallback(
    (oldItems: ReferenceAsset[], newItems: ReferenceAsset[]) => {
      const newUrlSet = new Set(newItems.map((r) => r.url || ossUrl(r.path)).filter(Boolean));
      const removedUrls = new Set<string>();
      for (const item of oldItems) {
        const url = item.url || ossUrl(item.path);
        if (url && !newUrlSet.has(url)) {
          removedUrls.add(url);
          if (item.url) removedUrls.add(item.url);
          if (item.path) removedUrls.add(item.path);
        }
      }
      if (removedUrls.size === 0) return;
      const cleaned = removeMentionsByUrls(prompt, removedUrls);
      if (cleaned !== prompt) {
        dispatch(updateVideoForm({ key, updates: { prompt: cleaned } }));
      }
    },
    [dispatch, key, prompt]
  );

  // ─── Generic ref setter with prompt cleanup ──
  const setRef = useCallback(
    (field: keyof VideoReferences, oldItems: ReferenceAsset[], newItems: ReferenceAsset[]) => {
      cleanPromptOnRefRemoval(oldItems, newItems);
      dispatch(setVideoReferences({ key, field, value: newItems }));
    },
    [cleanPromptOnRefRemoval, dispatch, key]
  );

  // ─── Setter callbacks ──
  const onSetReferenceImages = useCallback(
    (v: ReferenceAsset[]) => setRef("referenceImages", referenceImages, v),
    [setRef, referenceImages]
  );
  const onSetFirstFrames = useCallback(
    (v: ReferenceAsset[]) => setRef("firstFrames", firstFrames, v),
    [setRef, firstFrames]
  );
  const onSetLastFrames = useCallback(
    (v: ReferenceAsset[]) => setRef("lastFrames", lastFrames, v),
    [setRef, lastFrames]
  );
  const onSetMultiRefImages = useCallback(
    (v: (ReferenceAsset & { typeTag: MultiRefType })[]) =>
      setRef("multiRefImages", multiRefImages, v as ReferenceAsset[]),
    [setRef, multiRefImages]
  );
  const onSetRepaintRefVideos = useCallback(
    (v: ReferenceAsset[]) => setRef("repaintRefVideos", repaintRefVideos, v),
    [setRef, repaintRefVideos]
  );
  const onSetRepaintRefImage = useCallback(
    (v: ReferenceAsset[]) => setRef("repaintRefImage", repaintRefImage, v),
    [setRef, repaintRefImage]
  );
  const onSetLocalEditRefVideo = useCallback(
    (v: ReferenceAsset[]) => setRef("localEditRefVideo", localEditRefVideo, v),
    [setRef, localEditRefVideo]
  );
  const onSetLocalEditMaskImage = useCallback(
    (v: ReferenceAsset[]) => setRef("localEditMaskImage", localEditMaskImage, v),
    [setRef, localEditMaskImage]
  );
  const onSetLocalEditRefImage = useCallback(
    (v: ReferenceAsset[]) => setRef("localEditRefImage", localEditRefImage, v),
    [setRef, localEditRefImage]
  );
  const onSetExtendFirstClip = useCallback(
    (v: ReferenceAsset[]) => setRef("extendFirstClip", extendFirstClip, v),
    [setRef, extendFirstClip]
  );
  const onSetExtendLastClip = useCallback(
    (v: ReferenceAsset[]) => setRef("extendLastClip", extendLastClip, v),
    [setRef, extendLastClip]
  );
  const onSetExtendFirstFrame = useCallback(
    (v: ReferenceAsset[]) => setRef("extendFirstFrame", extendFirstFrame, v),
    [setRef, extendFirstFrame]
  );
  const onSetExtendLastFrame = useCallback(
    (v: ReferenceAsset[]) => setRef("extendLastFrame", extendLastFrame, v),
    [setRef, extendLastFrame]
  );
  const onSetOutpaintingRefVideo = useCallback(
    (v: ReferenceAsset[]) => setRef("outpaintingRefVideo", outpaintingRefVideo, v),
    [setRef, outpaintingRefVideo]
  );

  // ─── Picker select handler ──
  const handlePickerSelect = useCallback(
    (target: PickerTarget | null, paths: string[]) => {
      if (!target || paths.length === 0) return;

      // Map picker target → { field, maxCount, isAppend }
      const singleFields: Record<string, keyof VideoReferences> = {
        firstFrames: "firstFrames",
        lastFrames: "lastFrames",
        repaintVideo: "repaintRefVideos",
        repaintImage: "repaintRefImage",
        localEditVideo: "localEditRefVideo",
        localEditMask: "localEditMaskImage",
        localEditRefImage: "localEditRefImage",
        extendFirstClip: "extendFirstClip",
        extendLastClip: "extendLastClip",
        extendFirstFrame: "extendFirstFrame",
        extendLastFrame: "extendLastFrame",
        outpaintingVideo: "outpaintingRefVideo",
      };

      // Single-item slots (replace with first selected)
      if (target in singleFields) {
        const field = singleFields[target];
        const old = (references as Record<string, ReferenceAsset[]>)[field] ?? [];
        const newItems = toReferenceAssets(paths.slice(0, 1));
        cleanPromptOnRefRemoval(old, newItems);
        dispatch(setVideoReferences({ key, field, value: newItems }));
        return;
      }

      // referenceImages for reference mode (append, respect maxImages)
      if (target === "referenceImages") {
        const newRefs = dedupeRefs(referenceImages, toReferenceAssets(paths));
        onSetReferenceImages([...referenceImages, ...newRefs].slice(0, maxImages));
        return;
      }

      // Multimodal images (append)
      if (target === "multimodalImages") {
        const newRefs = dedupeRefs(referenceImages, toReferenceAssets(paths));
        onSetReferenceImages([...referenceImages, ...newRefs].slice(0, maxImages));
        return;
      }

      // Multimodal videos (append)
      if (target === "multimodalVideos") {
        const newVids = dedupeRefs(firstFrames, toReferenceAssets(paths));
        onSetFirstFrames([...firstFrames, ...newVids].slice(0, maxVideos || 3));
        return;
      }

      // Multi-reference subject
      if (target === "multiRefSubject") {
        onSetMultiRefImages([
          ...multiRefImages.filter((item) => item.typeTag === "bg"),
          ...(toReferenceAssets(paths.slice(0, 1), "obj") as (ReferenceAsset & {
            typeTag: MultiRefType;
          })[]),
        ]);
        return;
      }

      // Multi-reference background
      if (target === "multiRefBg") {
        onSetMultiRefImages([
          ...multiRefImages.filter((item) => item.typeTag !== "bg"),
          ...(toReferenceAssets(paths.slice(0, 2), "bg") as (ReferenceAsset & {
            typeTag: MultiRefType;
          })[]),
        ]);
      }
    },
    [
      cleanPromptOnRefRemoval,
      dispatch,
      key,
      references,
      referenceImages,
      firstFrames,
      multiRefImages,
      maxImages,
      maxVideos,
      onSetReferenceImages,
      onSetFirstFrames,
      onSetMultiRefImages,
    ]
  );

  // ─── Auto-add @mentioned media to reference group ──
  const handleMentionInserted = useCallback(
    (item: { imgUrl?: string; name: string; mentionType: string }) => {
      if (!item.imgUrl) return;
      if (referenceImages.some((r) => (r.url || ossUrl(r.path)) === item.imgUrl)) return;

      const mediaType = detectMediaType(item.imgUrl);
      const limit =
        mediaType === "video" ? maxVideos : mediaType === "audio" ? maxAudios : maxImages;
      if (referenceImages.length >= limit) return;

      const isNamed = ["character", "scene", "prop"].includes(item.mentionType);
      const label = isNamed ? item.name : undefined;
      dispatch(
        setVideoReferences({
          key,
          field: "referenceImages",
          value: [...referenceImages, { url: item.imgUrl, path: item.imgUrl, label }],
        })
      );
    },
    [dispatch, key, referenceImages, maxImages, maxVideos, maxAudios]
  );

  // ─── Initialization + enforcement ──
  const refInitDoneRef = useRef(false);
  useEffect(() => {
    if (!open) {
      refInitDoneRef.current = false;
      return;
    }
    if (modeModels.length === 0) return;

    // --- Initial fill ---
    if (!refInitDoneRef.current && referenceImages.length === 0) {
      if (!prompt && defaultPrompt) return; // wait for init to write prompt

      refInitDoneRef.current = true;
      const refs: Array<{ url: string; path: string }> = [];

      if (prompt) {
        const mentionRegex = /<mention\s+([^>]*)>([^<]*)<\/mention>/gi;
        const seen = new Set<string>();
        let match: RegExpExecArray | null;
        while ((match = mentionRegex.exec(prompt)) !== null) {
          const attrs = match[1];
          const name = match[2];
          const url = attrs.match(/imgUrl="([^"]*)"/i)?.[1] ?? "";
          const type = attrs.match(/type="([^"]*)"/)?.[1] ?? "reference";
          if (url && url !== "null" && !seen.has(url)) {
            seen.add(url);
            const isNamed = ["character", "scene", "prop"].includes(type);
            refs.push({ url, path: url, label: isNamed && name ? name : undefined });
          }
        }
      }

      if (refs.length === 0 && defaultReferenceImage) {
        refs.push({ url: ossUrl(defaultReferenceImage) ?? "", path: defaultReferenceImage });
      }

      if (refs.length > 0) {
        const kept = refs.slice(0, maxImages);
        dispatch(setVideoReferences({ key, field: "referenceImages", value: kept }));

        if (kept.length < refs.length) {
          const keptUrls = new Set(kept.map((r) => r.url).filter(Boolean));
          const droppedUrls = new Set<string>();
          for (const r of refs) {
            if (r.url && !keptUrls.has(r.url)) droppedUrls.add(r.url);
          }
          if (droppedUrls.size > 0) {
            const cleaned = removeMentionsByUrls(prompt, droppedUrls);
            if (cleaned !== prompt) {
              dispatch(updateVideoForm({ key, updates: { prompt: cleaned } }));
            }
          }
        }
      }

      // Fill firstFrames for frames mode
      if ((references.firstFrames ?? []).length === 0 && defaultReferenceImage) {
        dispatch(
          setVideoReferences({
            key,
            field: "firstFrames",
            value: [{ url: ossUrl(defaultReferenceImage) ?? "", path: defaultReferenceImage }],
          })
        );
      }
      return;
    }

    refInitDoneRef.current = true;

    // --- Enforcement: truncate when model limit decreases ---
    if (referenceImages.length > maxImages) {
      const kept = referenceImages.slice(0, maxImages);
      const keptUrls = new Set(kept.map((r) => r.url || ossUrl(r.path)).filter(Boolean));
      const removedUrls = new Set<string>();
      for (const item of referenceImages) {
        const url = item.url || ossUrl(item.path);
        if (url && !keptUrls.has(url)) {
          removedUrls.add(url);
          if (item.url) removedUrls.add(item.url);
          if (item.path) removedUrls.add(item.path);
        }
      }
      dispatch(setVideoReferences({ key, field: "referenceImages", value: kept }));
      if (removedUrls.size > 0) {
        const cleaned = removeMentionsByUrls(prompt, removedUrls);
        if (cleaned !== prompt) {
          dispatch(updateVideoForm({ key, updates: { prompt: cleaned } }));
        }
      }
    }
  }, [
    open,
    prompt,
    defaultPrompt,
    defaultReferenceImage,
    modeModels,
    maxImages,
    referenceImages,
    references,
    activeMode,
    dispatch,
    key,
  ]);

  // ─── Reference map ──
  const promptMentions = useMemo(() => extractMentionsFromHtml(prompt), [prompt]);
  const referenceMap: ReferenceMap = useMemo(
    () => buildReferenceMap(referenceImages, promptMentions),
    [referenceImages, promptMentions]
  );
  const referenceMapCtx = useMemo(
    () => ({ map: referenceMap, isFull: refIsFull }),
    [referenceMap, refIsFull]
  );

  return {
    // Limits
    maxImages,
    maxVideos,
    maxAudios,
    refIsFull,
    // Setters
    onSetReferenceImages,
    onSetFirstFrames,
    onSetLastFrames,
    onSetMultiRefImages,
    onSetRepaintRefVideos,
    onSetRepaintRefImage,
    onSetLocalEditRefVideo,
    onSetLocalEditMaskImage,
    onSetLocalEditRefImage,
    onSetExtendFirstClip,
    onSetExtendLastClip,
    onSetExtendFirstFrame,
    onSetExtendLastFrame,
    onSetOutpaintingRefVideo,
    // Handlers
    handlePickerSelect,
    handleMentionInserted,
    // Reference map
    referenceMapCtx,
  };
}
