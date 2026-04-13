import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/src/store";
import { selectCurrentInstance } from "@/src/store/slices/projectSlice";
import { MentionNode, MentionRefContext } from "./mention-node";
import type { MentionItem, MentionType } from "./mention-node";
import {
  fetchAssetList,
  ossUrl,
  getCharacterImages,
  getStringField,
  PAGE_SIZE,
  DEFAULT_POPOVER_WIDTH,
  POPOVER_MARGIN,
  type MentionSearchCharacter,
  type MentionSearchItem,
  type MentionFlatItem,
} from "./mention-editor-utils";
import { serializeEditorHtml, deserializeToEditorHtml } from "./mention-editor-serializer";
import { MentionPopover, type ReferenceMediaItem } from "./mention-popover";

export interface MentionEditorProps {
  value: string;
  editing: boolean;
  onSave: (value: string) => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  placeholder?: string;
  mentionItems: MentionItem[];
  allowedMentionTypes?: MentionType[];
  showAvatar?: boolean;
  extraFields?: Array<"voiceId" | "model">;
  referenceMedia?: ReferenceMediaItem[];
  onSelectReferenceMedia?: (item: ReferenceMediaItem) => void;
  /** Fires immediately when a mention chip is inserted (not on blur) */
  onMentionInserted?: (item: MentionFlatItem) => void;
}

export function MentionEditor({
  value,
  editing,
  onSave,
  onStartEdit,
  onStopEdit,
  placeholder,
  mentionItems,
  allowedMentionTypes,
  showAvatar = true,
  extraFields = [],
  referenceMedia,
  onSelectReferenceMedia,
  onMentionInserted,
}: MentionEditorProps) {
  const t = useTranslations("storyboard");
  const tc = useTranslations("common");
  const tScene = useTranslations("scene");
  const tProp = useTranslations("prop");
  const worldId = useAppSelector((state) => selectCurrentInstance(state).worldId);
  const popoverRef = useRef<HTMLDivElement>(null);
  const editingChipNodePosRef = useRef<number | null>(null);
  const mentionTriggerFromRef = useRef<number | null>(null);
  const committedValueRef = useRef(value);
  const searchAssetsRef = useRef<((query: string) => Promise<void>) | null>(null);
  const searchTimerRef = useRef<number | null>(null);
  const positionRafRef = useRef<number | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  const [mounted, setMounted] = useState(false);
  const [isEmpty, setIsEmpty] = useState(!value.trim());
  const [showMentionPopover, setShowMentionPopover] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [characters, setCharacters] = useState<MentionSearchCharacter[]>([]);
  const [scenes, setScenesState] = useState<MentionSearchItem[]>([]);
  const [propsList, setPropsList] = useState<MentionSearchItem[]>([]);
  const [loadingCharacters, setLoadingCharacters] = useState(false);
  const [loadingScenes, setLoadingScenes] = useState(false);
  const [loadingProps, setLoadingProps] = useState(false);
  const [loadingMoreCharacters, setLoadingMoreCharacters] = useState(false);
  const [loadingMoreScenes, setLoadingMoreScenes] = useState(false);
  const [loadingMoreProps, setLoadingMoreProps] = useState(false);
  const [hasMoreCharacters, setHasMoreCharacters] = useState(false);
  const [hasMoreScenes, setHasMoreScenes] = useState(false);
  const [hasMoreProps, setHasMoreProps] = useState(false);
  const [characterPage, setCharacterPage] = useState(1);
  const [scenePage, setScenePage] = useState(1);
  const [propPage, setPropPage] = useState(1);

  // We need a stable ref to the popover state for use in event handlers
  const showMentionPopoverRef = useRef(showMentionPopover);
  showMentionPopoverRef.current = showMentionPopover;

  const activeMentionTypes = useMemo<MentionType[]>(
    () => allowedMentionTypes ?? ["character", "scene", "prop"],
    [allowedMentionTypes]
  );

  const fallbackCharacters = useMemo(() => {
    const grouped = new Map<string, MentionSearchCharacter>();
    mentionItems
      .filter((item) => item.mentionType === "character")
      .forEach((item) => {
        const current = grouped.get(item.id);
        if (current) {
          if (item.imgUrl) current.images.push(item.imgUrl);
          if (!current.voiceId) current.voiceId = item.voiceId;
          if (!current.model) current.model = item.model;
          return;
        }

        grouped.set(item.id, {
          id: item.id,
          name: item.label,
          images: item.imgUrl ? [item.imgUrl] : [""],
          voiceId: item.voiceId,
          model: item.model,
        });
      });

    return Array.from(grouped.values());
  }, [mentionItems]);

  const fallbackScenes = useMemo(
    () =>
      mentionItems
        .filter((item) => item.mentionType === "scene")
        .map((item) => ({
          id: item.id,
          name: item.label,
          imgUrl: item.imgUrl,
        })),
    [mentionItems]
  );

  const fallbackProps = useMemo(
    () =>
      mentionItems
        .filter((item) => item.mentionType === "prop")
        .map((item) => ({
          id: item.id,
          name: item.label,
          imgUrl: item.imgUrl,
        })),
    [mentionItems]
  );

  const characterDisplayGroups = useMemo(
    () =>
      characters.map((character) => ({
        id: character.id,
        name: character.name,
        voiceId: character.voiceId,
        model: character.model,
        items: character.images.map((imgUrl, index) => ({
          key: `character-${character.id}-${index}`,
          imgUrl,
        })),
      })),
    [characters]
  );

  const flattenedItems = useMemo<MentionFlatItem[]>(() => {
    const items: MentionFlatItem[] = [];

    // Reference media at the top
    referenceMedia?.forEach((ref, i) => {
      items.push({
        key: `ref-${ref.path}-${i}`,
        id: ref.path,
        name: ref.label ?? `Reference ${i + 1}`,
        mentionType: "reference",
        imgUrl: ref.url,
      });
    });

    characterDisplayGroups.forEach((group) => {
      group.items.forEach((item, index) => {
        items.push({
          key: `${group.id}-${index}`,
          id: group.id,
          name: group.name,
          mentionType: "character",
          imgUrl: item.imgUrl,
          voiceId: group.voiceId,
          model: group.model,
        });
      });
    });

    scenes.forEach((scene) => {
      items.push({
        key: `scene-${scene.id}`,
        id: scene.id,
        name: scene.name,
        mentionType: "scene",
        imgUrl: scene.imgUrl,
      });
    });

    propsList.forEach((prop) => {
      items.push({
        key: `prop-${prop.id}`,
        id: prop.id,
        name: prop.name,
        mentionType: "prop",
        imgUrl: prop.imgUrl,
      });
    });

    return items;
  }, [referenceMedia, characterDisplayGroups, propsList, scenes]);

  const isSearching = loadingCharacters || loadingScenes || loadingProps;

  const isCharacterDisabled = useCallback(
    (item: { voiceId?: string; model?: string }) => {
      if (!extraFields.includes("voiceId")) return false;
      return !item.voiceId || !item.model;
    },
    [extraFields]
  );

  // -----------------------------------------------------------------------
  // Popover position
  // -----------------------------------------------------------------------

  const updatePopoverPosition = useCallback(() => {
    if (!showMentionPopoverRef.current) return;

    const popover = popoverRef.current;
    const viewportWidth = window.innerWidth || 0;
    const viewportHeight = window.innerHeight || 0;
    const maxWidth = Math.max(240, viewportWidth - POPOVER_MARGIN * 2);
    const width = Math.min(DEFAULT_POPOVER_WIDTH, maxWidth);
    const popoverHeight = popover?.offsetHeight || 360;

    let anchorRect: DOMRect | null = null;

    // If editing a chip, anchor to that chip's DOM element
    if (editingChipNodePosRef.current != null && editorContainerRef.current) {
      const chipEl = editorContainerRef.current.querySelector(`[data-mention-chip]`);
      // Try to find the specific chip by scanning NodeView wrappers
      const allChips = editorContainerRef.current.querySelectorAll("[data-mention-chip]");
      // We stored the node position -- find the chip at that position
      // For now, find the chip by matching data attributes from the editor
      if (allChips.length > 0) {
        // Use the editor to find the node at the stored position
        const pos = editingChipNodePosRef.current;
        // Find the DOM element for this position via the editor
        if (editor) {
          try {
            const domNode = editor.view.nodeDOM(pos);
            if (domNode instanceof HTMLElement) {
              anchorRect = domNode.getBoundingClientRect();
            }
          } catch {
            // position may be stale
          }
        }
      }
    }

    if (!anchorRect) {
      // Anchor to cursor position
      const selection = window.getSelection();
      if (selection?.rangeCount) {
        const range = selection.getRangeAt(0);
        const rects = range.getClientRects();
        anchorRect = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect();
      }
    }

    if (!anchorRect) {
      anchorRect = editorContainerRef.current?.getBoundingClientRect() ?? null;
    }
    if (!anchorRect) return;

    let left = anchorRect.left;
    if (left + width > viewportWidth - POPOVER_MARGIN) {
      left = viewportWidth - POPOVER_MARGIN - width;
    }
    if (left < POPOVER_MARGIN) {
      left = POPOVER_MARGIN;
    }

    let top = anchorRect.bottom + 6;
    if (top + popoverHeight > viewportHeight - POPOVER_MARGIN) {
      top = anchorRect.top - popoverHeight - 6;
    }
    if (top < POPOVER_MARGIN) {
      top = POPOVER_MARGIN;
    }

    setPopoverStyle({
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
    });
  }, []);

  const schedulePopoverPositionUpdate = useCallback(() => {
    if (positionRafRef.current) return;
    positionRafRef.current = window.requestAnimationFrame(() => {
      positionRafRef.current = null;
      updatePopoverPosition();
    });
  }, [updatePopoverPosition]);

  // -----------------------------------------------------------------------
  // Search / fetch logic (unchanged from original)
  // -----------------------------------------------------------------------

  const applyFallbackSearch = useCallback(
    (query: string) => {
      const normalizedQuery = query.trim().toLowerCase();
      const matches = (label: string) =>
        !normalizedQuery || label.toLowerCase().includes(normalizedQuery);

      setCharacters(
        activeMentionTypes.includes("character")
          ? fallbackCharacters.filter((item) => matches(item.name))
          : []
      );
      setScenesState(
        activeMentionTypes.includes("scene")
          ? fallbackScenes.filter((item) => matches(item.name))
          : []
      );
      setPropsList(
        activeMentionTypes.includes("prop")
          ? fallbackProps.filter((item) => matches(item.name))
          : []
      );
      setHasMoreCharacters(false);
      setHasMoreScenes(false);
      setHasMoreProps(false);
      setLoadingCharacters(false);
      setLoadingScenes(false);
      setLoadingProps(false);
    },
    [activeMentionTypes, fallbackCharacters, fallbackProps, fallbackScenes]
  );

  const searchAssets = useCallback(
    async (query: string) => {
      if (!worldId) {
        applyFallbackSearch(query);
        return;
      }

      setCharacterPage(1);
      setScenePage(1);
      setPropPage(1);

      if (activeMentionTypes.includes("character")) setLoadingCharacters(true);
      if (activeMentionTypes.includes("scene")) setLoadingScenes(true);
      if (activeMentionTypes.includes("prop")) setLoadingProps(true);

      try {
        const [characterResponse, sceneResponse, propResponse] = await Promise.all([
          activeMentionTypes.includes("character")
            ? fetchAssetList("role", worldId, {
                page: 1,
                pageSize: PAGE_SIZE,
                name: query || undefined,
              })
            : Promise.resolve(null),
          activeMentionTypes.includes("scene")
            ? fetchAssetList("scene", worldId, {
                page: 1,
                pageSize: PAGE_SIZE,
                name: query || undefined,
              })
            : Promise.resolve(null),
          activeMentionTypes.includes("prop")
            ? fetchAssetList("prop", worldId, {
                page: 1,
                pageSize: PAGE_SIZE,
                name: query || undefined,
              })
            : Promise.resolve(null),
        ]);

        setCharacters(
          (characterResponse?.list ?? [])
            .filter((item) => item.id && item.name)
            .map((item) => ({
              id: String(item.id),
              name: String(item.name),
              images: getCharacterImages(item),
              voiceId: getStringField(item, "voiceId"),
              model: getStringField(item, "model"),
            }))
        );
        setScenesState(
          (sceneResponse?.list ?? [])
            .filter((item) => item.id && item.name)
            .map((item) => ({
              id: String(item.id),
              name: String(item.name),
              imgUrl: ossUrl(item.sceneImgPath?.[0]),
            }))
        );
        setPropsList(
          (propResponse?.list ?? [])
            .filter((item) => item.id && item.name)
            .map((item) => ({
              id: String(item.id),
              name: String(item.name),
              imgUrl: ossUrl(item.propImgPath?.[0]),
            }))
        );

        setHasMoreCharacters((characterResponse?.list?.length ?? 0) >= PAGE_SIZE);
        setHasMoreScenes((sceneResponse?.list?.length ?? 0) >= PAGE_SIZE);
        setHasMoreProps((propResponse?.list?.length ?? 0) >= PAGE_SIZE);
      } catch (error) {
        console.error("[MentionEditor] 搜索引用失败:", error);
        applyFallbackSearch(query);
      } finally {
        setLoadingCharacters(false);
        setLoadingScenes(false);
        setLoadingProps(false);
      }
    },
    [activeMentionTypes, applyFallbackSearch, worldId]
  );

  useEffect(() => {
    searchAssetsRef.current = searchAssets;
  }, [searchAssets]);

  const loadMoreCharacters = useCallback(async () => {
    if (!worldId || loadingMoreCharacters || !hasMoreCharacters) return;
    const nextPage = characterPage + 1;
    setLoadingMoreCharacters(true);
    try {
      const response = await fetchAssetList("role", worldId, {
        page: nextPage,
        pageSize: PAGE_SIZE,
        name: searchQuery || undefined,
      });
      const list = response?.list ?? [];
      setCharacters((current) => [
        ...current,
        ...list
          .filter((item) => item.id && item.name)
          .map((item) => ({
            id: String(item.id),
            name: String(item.name),
            images: getCharacterImages(item),
            voiceId: getStringField(item, "voiceId"),
            model: getStringField(item, "model"),
          })),
      ]);
      setCharacterPage(nextPage);
      setHasMoreCharacters(list.length >= PAGE_SIZE);
    } catch (error) {
      console.error("[MentionEditor] 加载更多角色失败:", error);
    } finally {
      setLoadingMoreCharacters(false);
    }
  }, [characterPage, hasMoreCharacters, loadingMoreCharacters, searchQuery, worldId]);

  const loadMoreScenes = useCallback(async () => {
    if (!worldId || loadingMoreScenes || !hasMoreScenes) return;
    const nextPage = scenePage + 1;
    setLoadingMoreScenes(true);
    try {
      const response = await fetchAssetList("scene", worldId, {
        page: nextPage,
        pageSize: PAGE_SIZE,
        name: searchQuery || undefined,
      });
      const list = response?.list ?? [];
      setScenesState((current) => [
        ...current,
        ...list
          .filter((item) => item.id && item.name)
          .map((item) => ({
            id: String(item.id),
            name: String(item.name),
            imgUrl: ossUrl(item.sceneImgPath?.[0]),
          })),
      ]);
      setScenePage(nextPage);
      setHasMoreScenes(list.length >= PAGE_SIZE);
    } catch (error) {
      console.error("[MentionEditor] 加载更多场景失败:", error);
    } finally {
      setLoadingMoreScenes(false);
    }
  }, [hasMoreScenes, loadingMoreScenes, scenePage, searchQuery, worldId]);

  const loadMoreProps = useCallback(async () => {
    if (!worldId || loadingMoreProps || !hasMoreProps) return;
    const nextPage = propPage + 1;
    setLoadingMoreProps(true);
    try {
      const response = await fetchAssetList("prop", worldId, {
        page: nextPage,
        pageSize: PAGE_SIZE,
        name: searchQuery || undefined,
      });
      const list = response?.list ?? [];
      setPropsList((current) => [
        ...current,
        ...list
          .filter((item) => item.id && item.name)
          .map((item) => ({
            id: String(item.id),
            name: String(item.name),
            imgUrl: ossUrl(item.propImgPath?.[0]),
          })),
      ]);
      setPropPage(nextPage);
      setHasMoreProps(list.length >= PAGE_SIZE);
    } catch (error) {
      console.error("[MentionEditor] 加载更多道具失败:", error);
    } finally {
      setLoadingMoreProps(false);
    }
  }, [hasMoreProps, loadingMoreProps, propPage, searchQuery, worldId]);

  // -----------------------------------------------------------------------
  // Popover open / close / select
  // -----------------------------------------------------------------------

  const closeMentionPopover = useCallback(() => {
    setShowMentionPopover(false);
    mentionTriggerFromRef.current = null;
    editingChipNodePosRef.current = null;
    setSearchQuery("");
    setSelectedIndex(0);
    if (searchTimerRef.current) {
      window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
  }, []);

  const openMentionPopover = useCallback(
    (triggerFrom?: number) => {
      if (triggerFrom != null) {
        mentionTriggerFromRef.current = triggerFrom;
      }
      setSearchQuery("");
      setSelectedIndex(0);
      setShowMentionPopover(true);
      void searchAssets("");
    },
    [searchAssets]
  );

  // -----------------------------------------------------------------------
  // Tiptap editor
  // -----------------------------------------------------------------------

  // Track whether we are programmatically setting content to avoid feedback loops
  const suppressUpdateRef = useRef(false);

  const editor = useEditor({
    immediatelyRender: false,
    editable: editing,
    extensions: [
      StarterKit.configure({
        // Disable features we don't need
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        bold: false,
        italic: false,
        strike: false,
        code: false,
      }),
      MentionNode,
    ],
    content: deserializeToEditorHtml(value),
    editorProps: {
      attributes: {
        class: cn(
          "w-full min-h-[2rem] whitespace-pre-wrap break-words bg-transparent text-xs leading-relaxed text-foreground outline-none",
          showAvatar ? "" : "[&_.mention-chip-wrapper]:gap-1"
        ),
      },
    },
    onUpdate: ({ editor: instance }) => {
      if (suppressUpdateRef.current) return;
      const text = instance.getText();
      setIsEmpty(!text.trim());
    },
  });

  // Refs that need access to editor in callbacks
  const editorRef = useRef(editor);
  editorRef.current = editor;

  // Update editable state when editing prop changes
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editing);
  }, [editor, editing]);

  // Set content when value changes externally
  useEffect(() => {
    if (!editor || !editing) return;
    const currentHtml = editor.getHTML();
    const serialized = serializeEditorHtml(currentHtml, showAvatar);
    // Only update if the value actually changed (not from our own edits)
    if (serialized !== value && value !== committedValueRef.current) {
      suppressUpdateRef.current = true;
      editor.commands.setContent(deserializeToEditorHtml(value));
      suppressUpdateRef.current = false;
      committedValueRef.current = value;
      setIsEmpty(!editor.getText().trim());
    }
  }, [editor, editing, value, showAvatar]);

  // Focus editor when entering edit mode
  useEffect(() => {
    if (!editing || !editor) return;
    // Small delay to ensure DOM is ready
    const timer = window.setTimeout(() => {
      editor.commands.focus("end");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [editing, editor]);

  // -----------------------------------------------------------------------
  // Commit and close
  // -----------------------------------------------------------------------

  const commitAndClose = useCallback(() => {
    if (!editor) return;
    const html = editor.getHTML();
    const nextValue = serializeEditorHtml(html, showAvatar);
    if (nextValue !== committedValueRef.current) {
      committedValueRef.current = nextValue;
      onSave(nextValue);
    }
    setShowMentionPopover(false);
    mentionTriggerFromRef.current = null;
    editingChipNodePosRef.current = null;
    onStopEdit();
  }, [editor, onSave, onStopEdit, showAvatar]);

  // -----------------------------------------------------------------------
  // Insert / replace mention via popover selection
  // -----------------------------------------------------------------------

  const handleSelectMention = useCallback(
    (item: MentionFlatItem) => {
      if (!editor) return;
      if (item.mentionType === "character" && isCharacterDisabled(item)) return;

      const editingPos = editingChipNodePosRef.current;
      if (editingPos != null) {
        // Replace existing chip at the stored position
        try {
          const node = editor.state.doc.nodeAt(editingPos);
          if (node && node.type.name === "mentionChip") {
            editor
              .chain()
              .focus()
              .command(({ tr }) => {
                tr.replaceWith(
                  editingPos,
                  editingPos + node.nodeSize,
                  editor.schema.nodes.mentionChip.create({
                    id: item.id,
                    label: item.name,
                    mentionType: item.mentionType,
                    imgUrl: item.imgUrl ?? "",
                    voiceId: item.voiceId ?? "",
                    model: item.model ?? "",
                  })
                );
                return true;
              })
              .run();
          }
        } catch {
          // Position may be stale; just insert at cursor
          editor
            .chain()
            .focus()
            .insertContent({
              type: "mentionChip",
              attrs: {
                id: item.id,
                label: item.name,
                mentionType: item.mentionType,
                imgUrl: item.imgUrl ?? "",
                voiceId: item.voiceId ?? "",
                model: item.model ?? "",
              },
            })
            .run();
        }
      } else {
        // New mention: delete the @query text first, then insert the chip
        const triggerFrom = mentionTriggerFromRef.current;
        if (triggerFrom != null) {
          const { from: cursorFrom } = editor.state.selection;
          editor
            .chain()
            .focus()
            .command(({ tr }) => {
              // Delete from @ position to current cursor
              tr.delete(triggerFrom, cursorFrom);
              return true;
            })
            .insertContent({
              type: "mentionChip",
              attrs: {
                id: item.id,
                label: item.name,
                mentionType: item.mentionType,
                imgUrl: item.imgUrl ?? "",
                voiceId: item.voiceId ?? "",
                model: item.model ?? "",
              },
            })
            .run();
        } else {
          editor
            .chain()
            .focus()
            .insertContent({
              type: "mentionChip",
              attrs: {
                id: item.id,
                label: item.name,
                mentionType: item.mentionType,
                imgUrl: item.imgUrl ?? "",
                voiceId: item.voiceId ?? "",
                model: item.model ?? "",
              },
            })
            .run();
        }
      }

      closeMentionPopover();
      editor.commands.focus();
      setIsEmpty(!editor.getText().trim());
      onMentionInserted?.(item);
    },
    [closeMentionPopover, editor, isCharacterDisabled, onMentionInserted]
  );

  // -----------------------------------------------------------------------
  // @ trigger detection from editor input
  // -----------------------------------------------------------------------

  const updateSearchQueryFromEditor = useCallback(() => {
    if (!editor) return;
    const triggerFrom = mentionTriggerFromRef.current;
    if (triggerFrom == null) {
      closeMentionPopover();
      return;
    }

    const { from } = editor.state.selection;
    // Get text between @ and cursor
    const textBetween = editor.state.doc.textBetween(triggerFrom, from, "");
    // The first character should be @ -- skip it
    const query = textBetween.startsWith("@") ? textBetween.slice(1) : textBetween;

    // If there's a space in the query, close the popover
    if (/\s/.test(query)) {
      closeMentionPopover();
      return;
    }

    setSearchQuery(query);
    setSelectedIndex(0);

    if (searchTimerRef.current) {
      window.clearTimeout(searchTimerRef.current);
    }
    searchTimerRef.current = window.setTimeout(() => {
      void searchAssets(query);
    }, 300);
  }, [closeMentionPopover, editor, searchAssets]);

  // Handle editor updates for @ detection
  useEffect(() => {
    if (!editor) return;

    const handleUpdate = () => {
      if (showMentionPopoverRef.current && editingChipNodePosRef.current == null) {
        updateSearchQueryFromEditor();
        schedulePopoverPositionUpdate();
      }

      // Detect @ typed at cursor
      if (!showMentionPopoverRef.current) {
        const { from } = editor.state.selection;
        if (from < 2) return;
        const charBefore = editor.state.doc.textBetween(from - 1, from, "");
        if (charBefore === "@" || charBefore === "＠") {
          // Replace fullwidth @ with halfwidth
          if (charBefore === "＠") {
            editor
              .chain()
              .command(({ tr }) => {
                tr.insertText("@", from - 1, from);
                return true;
              })
              .run();
          }
          mentionTriggerFromRef.current = from - 1;
          openMentionPopover(from - 1);
        }
      }
    };

    editor.on("update", handleUpdate);
    return () => {
      editor.off("update", handleUpdate);
    };
  }, [editor, openMentionPopover, updateSearchQueryFromEditor, schedulePopoverPositionUpdate]);

  // Handle selection updates for popover positioning
  useEffect(() => {
    if (!editor) return;

    const handleSelectionUpdate = () => {
      if (showMentionPopoverRef.current) {
        schedulePopoverPositionUpdate();
      }
    };

    editor.on("selectionUpdate", handleSelectionUpdate);
    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate);
    };
  }, [editor, schedulePopoverPositionUpdate]);

  // Handle clicks on mention chips to open the popover for editing
  useEffect(() => {
    if (!editor) return;

    const handleChipClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const chipEl = target.closest("[data-mention-chip]");
      if (!chipEl) return;

      event.preventDefault();
      event.stopPropagation();

      // Find the ProseMirror position of this chip
      try {
        const pos = editor.view.posAtDOM(chipEl, 0);
        if (pos != null) {
          const resolved = editor.state.doc.resolve(pos);
          const nodePos = resolved.before(resolved.depth);
          editingChipNodePosRef.current = nodePos;
        }
      } catch {
        // position lookup failed; the popover will still open, just no replacement
      }

      setSearchQuery("");
      setSelectedIndex(0);
      setShowMentionPopover(true);
      void searchAssetsRef.current?.("");
    };

    const editorDom = editor.view.dom;
    editorDom.addEventListener("click", handleChipClick);
    return () => {
      editorDom.removeEventListener("click", handleChipClick);
    };
  }, [editor]);

  // -----------------------------------------------------------------------
  // Keyboard handling for popover navigation
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!editor) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!showMentionPopoverRef.current) return;

      if (event.key === "Escape") {
        event.preventDefault();
        closeMentionPopover();
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        if (flattenedItems.length === 0) return;
        let nextIndex = selectedIndex - 1;
        while (nextIndex >= 0 && isCharacterDisabled(flattenedItems[nextIndex])) {
          nextIndex -= 1;
        }
        if (nextIndex >= 0) setSelectedIndex(nextIndex);
        return;
      }

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        if (flattenedItems.length === 0) return;
        let nextIndex = selectedIndex + 1;
        while (
          nextIndex < flattenedItems.length &&
          isCharacterDisabled(flattenedItems[nextIndex])
        ) {
          nextIndex += 1;
        }
        if (nextIndex < flattenedItems.length) setSelectedIndex(nextIndex);
        return;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const selected = flattenedItems[selectedIndex];
        if (selected) {
          handleSelectMention(selected);
        }
        return;
      }

      if (event.key === " ") {
        closeMentionPopover();
      }
    };

    // Use capture phase to intercept before tiptap's own handling
    const editorDom = editor.view.dom;
    editorDom.addEventListener("keydown", handleKeyDown, true);
    return () => {
      editorDom.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [
    closeMentionPopover,
    editor,
    flattenedItems,
    handleSelectMention,
    isCharacterDisabled,
    selectedIndex,
  ]);

  // -----------------------------------------------------------------------
  // Outside click
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!editing) return;

    const handleOutsidePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (editorContainerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      commitAndClose();
    };

    const handleViewportChange = () => {
      if (!showMentionPopoverRef.current) return;
      schedulePopoverPositionUpdate();
    };

    document.addEventListener("mousedown", handleOutsidePointerDown, true);
    document.addEventListener("touchstart", handleOutsidePointerDown, true);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      document.removeEventListener("mousedown", handleOutsidePointerDown, true);
      document.removeEventListener("touchstart", handleOutsidePointerDown, true);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [commitAndClose, editing, schedulePopoverPositionUpdate]);

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!showMentionPopover) return;

    const total = flattenedItems.length;
    if (total === 0) {
      setSelectedIndex(0);
      return;
    }

    const nextIndex = flattenedItems.findIndex(
      (item) => item.mentionType !== "character" || !isCharacterDisabled(item)
    );
    if (nextIndex >= 0) {
      setSelectedIndex((current) =>
        current >= total ||
        (flattenedItems[current] && isCharacterDisabled(flattenedItems[current]))
          ? nextIndex
          : current
      );
    }
  }, [flattenedItems, isCharacterDisabled, showMentionPopover]);

  useEffect(() => {
    if (!showMentionPopover) return;
    schedulePopoverPositionUpdate();
  }, [showMentionPopover, schedulePopoverPositionUpdate, flattenedItems.length, isSearching]);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) {
        window.clearTimeout(searchTimerRef.current);
      }
      if (positionRafRef.current) {
        window.cancelAnimationFrame(positionRafRef.current);
      }
    };
  }, []);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const refContextValue = useMemo(
    () => ({
      refImages: (referenceMedia ?? []).map((r) => ({ url: r.url })),
      refLabel: (i: number) => `${t("referenceImage")} ${i + 1}`,
    }),
    [referenceMedia, t]
  );

  return (
    <>
      <MentionRefContext.Provider value={refContextValue}>
        <div onDoubleClick={onStartEdit} ref={editorContainerRef}>
          <div className="relative min-h-[2rem]">
            {isEmpty && placeholder ? (
              <div className="pointer-events-none absolute left-0 top-0 text-xs leading-relaxed text-muted-foreground/30">
                {placeholder}
              </div>
            ) : null}
            <EditorContent editor={editor} />
          </div>
        </div>
      </MentionRefContext.Provider>

      {mounted && showMentionPopover ? (
        <MentionPopover
          popoverRef={popoverRef}
          popoverStyle={popoverStyle}
          searchQuery={searchQuery}
          isSearching={isSearching}
          activeMentionTypes={activeMentionTypes}
          selectedIndex={selectedIndex}
          flattenedItems={flattenedItems}
          characterDisplayGroups={characterDisplayGroups}
          scenes={scenes}
          propsList={propsList}
          loadingCharacters={loadingCharacters}
          loadingScenes={loadingScenes}
          loadingProps={loadingProps}
          hasMoreCharacters={hasMoreCharacters}
          hasMoreScenes={hasMoreScenes}
          hasMoreProps={hasMoreProps}
          loadingMoreCharacters={loadingMoreCharacters}
          loadingMoreScenes={loadingMoreScenes}
          loadingMoreProps={loadingMoreProps}
          isCharacterDisabled={isCharacterDisabled}
          onSelectMention={handleSelectMention}
          onLoadMoreCharacters={loadMoreCharacters}
          onLoadMoreScenes={loadMoreScenes}
          onLoadMoreProps={loadMoreProps}
          referenceMedia={referenceMedia}
          onSelectReferenceMedia={onSelectReferenceMedia}
          tc={tc}
          tScene={tScene}
          tProp={tProp}
        />
      ) : null}
    </>
  );
}

/** @deprecated Use `MentionEditor` instead. Kept for backward compatibility. */
export { MentionEditor as TiptapCell };

/** @deprecated Use `MentionEditorProps` instead. */
export type TiptapCellProps = MentionEditorProps;
