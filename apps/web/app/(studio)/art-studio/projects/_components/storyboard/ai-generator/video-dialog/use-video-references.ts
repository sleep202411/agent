"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import { useAppDispatch } from "@/src/store";
import {
  setVideoReferences,
  updateVideoForm,
  type VideoReferences,
} from "@/src/store/slices/projectSlice";
import { classifyAsset, type AiModel } from "@/components/ui/schema-field/schema";
import {
  buildReferenceMap,
  extractMentionsFromHtml,
  removeMentionsByUrls,
  detectMediaType,
} from "@/app/(studio)/art-studio/projects/_components/storyboard/editor/build-reference-map";
import type { ReferenceMap } from "@/app/(studio)/art-studio/projects/_components/storyboard/editor/reference-map-context";
import {
  dedupeRefs,
  isVideoFrameReferenceMentionPath,
  ossUrl,
  toReferenceAssets,
  videoFrameReferenceMentionPath,
  type MultiRefType,
  type PickerTarget,
  type ReferenceAsset,
} from "@/src/lib/video-types";

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

type VideoReferenceMediaItem = {
  url: string;
  path: string;
  label?: string;
  kind: "image" | "video" | "audio";
};

function removeReferenceMentionsByUrls(html: string, urlsToRemove: Set<string>) {
  if (urlsToRemove.size === 0 || !html.includes("<mention")) return html;

  const result = html.replace(
    /<mention\s+([^>]*)>[^<]*<\/mention>/gi,
    (fullMatch, attrs: string) => {
      const type = attrs.match(/type="([^"]*)"/i)?.[1] ?? "";
      const imgUrl = attrs.match(/imgUrl="([^"]*)"/i)?.[1] ?? "";
      if (type === "reference" && imgUrl && urlsToRemove.has(imgUrl)) return "";
      return fullMatch;
    }
  );

  return result === html ? html : result;
}

function collectMentionUrls(items: VideoReferenceMediaItem[]) {
  const urls = new Set<string>();
  for (const item of items) {
    if (item.url) urls.add(item.url);
    if (item.path && !isVideoFrameReferenceMentionPath(item.path)) {
      urls.add(item.path);
      urls.add(ossUrl(item.path));
    }
  }
  return urls;
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
  const minImages = currentModel?.minImages ?? 0;
  const minVideos = currentModel?.minVideos ?? 0;
  const minAudios = currentModel?.minAudios ?? 0;

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

  // Only the reference/multimodal buckets auto-add @ mentions into
  // referenceImages. Mode-specific slots expose existing assets and should
  // not be disabled by stale refs from another mode.
  const refIsFull =
    (activeMode === "reference" || activeMode === "multimodal") &&
    referenceImages.filter((item) => classifyAsset(item) === "image").length >= maxImages;

  const referenceMediaItems = useMemo<VideoReferenceMediaItem[]>(() => {
    const items: VideoReferenceMediaItem[] = [];
    const addItem = (
      asset: ReferenceAsset | undefined,
      label?: string,
      kind?: "image" | "video" | "audio"
    ) => {
      if (!asset) return;
      const path = asset.path || asset.url || "";
      if (!path) return;
      items.push({
        url: asset.url || ossUrl(asset.path),
        path,
        label,
        kind: kind ?? classifyAsset(asset),
      });
    };
    const addFrameItem = (
      asset: ReferenceAsset | undefined,
      slot: "first" | "last",
      label: string
    ) => {
      if (!asset) return;
      const sourcePath = asset.path || asset.url || "";
      if (!sourcePath) return;
      items.push({
        url: asset.url || ossUrl(asset.path),
        path: videoFrameReferenceMentionPath(slot, sourcePath),
        label,
        kind: "image",
      });
    };

    switch (activeMode) {
      case "frames":
        addFrameItem(firstFrames[0], "first", t("firstFrame"));
        addFrameItem(lastFrames[0], "last", t("lastFrame"));
        return items;
      case "multiReference": {
        const counts = { subject: 0, background: 0 };
        for (const item of multiRefImages) {
          const isBackground = item.typeTag === "bg";
          if (isBackground) {
            counts.background += 1;
            addItem(item, `${t("backgroundLabel")} ${counts.background}`, "image");
          } else {
            counts.subject += 1;
            addItem(item, `${t("subjectLabel")} ${counts.subject}`, "image");
          }
        }
        return items;
      }
      case "repaint":
        addItem(repaintRefVideos[0], t("video"), "video");
        addItem(repaintRefImage[0], t("referenceImage"), "image");
        return items;
      case "localEdit":
        addItem(localEditRefVideo[0], t("video"), "video");
        addItem(localEditMaskImage[0], t("maskImage"), "image");
        addItem(localEditRefImage[0], t("referenceImage"), "image");
        return items;
      case "extend":
        addItem(extendFirstClip[0], t("firstClipLabel"), "video");
        addItem(extendLastClip[0], t("lastClipLabel"), "video");
        addItem(extendFirstFrame[0], t("firstFrameImage"), "image");
        addItem(extendLastFrame[0], t("lastFrameImage"), "image");
        return items;
      case "outpainting":
        addItem(outpaintingRefVideo[0], t("video"), "video");
        return items;
      case "reference":
      case "multimodal":
      default: {
        const counts = { image: 0, video: 0, audio: 0 } as Record<
          "image" | "video" | "audio",
          number
        >;
        for (const item of referenceImages) {
          const kind = classifyAsset(item);
          counts[kind] += 1;
          const prefix =
            kind === "video"
              ? t("referenceVideo")
              : kind === "audio"
                ? t("referenceAudio")
                : t("referenceImage");
          addItem(item, item.label || `${prefix} ${counts[kind]}`, kind);
        }
        return items;
      }
    }
  }, [
    activeMode,
    extendFirstClip,
    extendFirstFrame,
    extendLastClip,
    extendLastFrame,
    firstFrames,
    lastFrames,
    localEditMaskImage,
    localEditRefImage,
    localEditRefVideo,
    multiRefImages,
    outpaintingRefVideo,
    referenceImages,
    repaintRefImage,
    repaintRefVideos,
    t,
  ]);

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
        const old = (references as unknown as Record<string, ReferenceAsset[]>)[field] ?? [];
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

      // Multimodal: all 3 kinds share referenceImages bucket, per-kind caps apply within bucket
      if (
        target === "multimodalImages" ||
        target === "multimodalVideos" ||
        target === "multimodalAudios"
      ) {
        const kind =
          target === "multimodalVideos"
            ? "video"
            : target === "multimodalAudios"
              ? "audio"
              : "image";
        const kindCap = kind === "video" ? maxVideos : kind === "audio" ? maxAudios : maxImages;
        const currentOfKind = referenceImages.filter((item) => classifyAsset(item) === kind);
        const incoming = dedupeRefs(referenceImages, toReferenceAssets(paths, undefined, kind));
        const slotsLeft = Math.max(0, kindCap - currentOfKind.length);
        if (slotsLeft <= 0 || incoming.length === 0) return;
        onSetReferenceImages([...referenceImages, ...incoming.slice(0, slotsLeft)]);
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
      multiRefImages,
      maxImages,
      maxVideos,
      maxAudios,
      onSetReferenceImages,
      onSetMultiRefImages,
    ]
  );

  // ─── Auto-add @mentioned media to reference group ──
  const handleMentionInserted = useCallback(
    (item: { id?: string; imgUrl?: string; name: string; mentionType: string }) => {
      if (!item.imgUrl) return;
      if (activeMode !== "reference" && activeMode !== "multimodal") {
        return;
      }
      if (item.id && isVideoFrameReferenceMentionPath(item.id)) {
        return;
      }
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
    [activeMode, dispatch, key, referenceImages, maxImages, maxVideos, maxAudios]
  );

  const previousModeRefs = useRef<{ mode: string; urls: Set<string> } | null>(null);
  useEffect(() => {
    if (!open) {
      previousModeRefs.current = null;
      return;
    }

    const currentUrls = collectMentionUrls(referenceMediaItems);
    const previous = previousModeRefs.current;

    if (previous && previous.mode !== activeMode) {
      const staleUrls = new Set<string>();
      for (const url of previous.urls) {
        if (!currentUrls.has(url)) staleUrls.add(url);
      }

      if (staleUrls.size > 0) {
        const cleaned = removeReferenceMentionsByUrls(prompt, staleUrls);
        if (cleaned !== prompt) {
          dispatch(updateVideoForm({ key, updates: { prompt: cleaned } }));
        }
      }
    }

    previousModeRefs.current = { mode: activeMode, urls: currentUrls };
  }, [activeMode, dispatch, key, open, prompt, referenceMediaItems]);

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
      const refs: Array<{ url: string; path: string; label?: string }> = [];

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

    // --- Enforcement: truncate per-kind when a cap decreases ---
    const caps: Record<"image" | "video" | "audio", number> = {
      image: maxImages,
      video: maxVideos,
      audio: maxAudios,
    };
    const countsSeen: Record<"image" | "video" | "audio", number> = {
      image: 0,
      video: 0,
      audio: 0,
    };
    const kept: ReferenceAsset[] = [];
    const dropped: ReferenceAsset[] = [];
    for (const item of referenceImages) {
      const kind = classifyAsset(item);
      if (countsSeen[kind] < caps[kind]) {
        countsSeen[kind] += 1;
        kept.push(item);
      } else {
        dropped.push(item);
      }
    }
    if (dropped.length > 0) {
      const removedUrls = new Set<string>();
      for (const item of dropped) {
        const url = item.url || ossUrl(item.path);
        if (url) removedUrls.add(url);
        if (item.url) removedUrls.add(item.url);
        if (item.path) removedUrls.add(item.path);
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
    maxVideos,
    maxAudios,
    referenceImages,
    references,
    activeMode,
    dispatch,
    key,
  ]);

  // ─── Reference map ──
  const promptMentions = useMemo(() => extractMentionsFromHtml(prompt), [prompt]);
  const refPrefixImage = t("referenceImage");
  const refPrefixVideo = t("referenceVideo");
  const refPrefixAudio = t("referenceAudio");
  const refPrefixes = useMemo(
    () => ({ image: refPrefixImage, video: refPrefixVideo, audio: refPrefixAudio }),
    [refPrefixImage, refPrefixVideo, refPrefixAudio]
  );
  const referenceMap: ReferenceMap = useMemo(
    () => buildReferenceMap(referenceMediaItems, promptMentions, refPrefixes),
    [referenceMediaItems, promptMentions, refPrefixes]
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
    minImages,
    minVideos,
    minAudios,
    refIsFull,
    referenceMediaItems,
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
