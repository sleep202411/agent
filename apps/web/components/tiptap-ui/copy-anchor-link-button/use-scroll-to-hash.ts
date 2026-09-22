"use client";

import { useCallback, useEffect, useRef } from "react";
import { type Editor } from "@tiptap/react";
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";
import { getEditorExtension } from "@/lib/tiptap-advanced-utils";
import { selectNodeAndHideFloating } from "@/hooks/use-floating-toolbar-visibility";

const noop = () => {};

export interface UseScrollToHashConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null;
  /**
   * Callback called when the target node is found.
   * @param nodeId The ID of the found node
   */
  onTargetFound?: (nodeId: string) => void;
  /**
   * Callback called when the target node is not found.
   * @param hash The hash that was attempted to be scrolled to
   */
  onTargetNotFound?: (hash: string) => void;
}

/**
 * Hook to scroll to a specific hash in the Tiptap editor.
 * It finds the node with the given ID and scrolls it into view.
 *
 * @param config Configuration for the scroll behavior
 * @returns Function to scroll to a specific hash
 */
export function useScrollToHash(config: UseScrollToHashConfig = {}) {
  const { editor: providedEditor, onTargetFound = noop, onTargetNotFound = noop } = config;

  const { editor } = useTiptapEditor(providedEditor);

  const scopeRef = useRef<{
    editor: Editor | null;
    lastProcessedHash: string | null;
    timers: Set<ReturnType<typeof setTimeout>>;
  } | null>(null);

  useEffect(() => {
    const scope = {
      editor,
      lastProcessedHash: null,
      timers: new Set<ReturnType<typeof setTimeout>>(),
    };
    scopeRef.current = scope;
    return () => {
      if (scopeRef.current === scope) scopeRef.current = null;
      scope.timers.forEach(clearTimeout);
      scope.timers.clear();
    };
  }, [editor]);

  const schedule = useCallback(
    (callback: () => void, delay: number) => {
      const scope = scopeRef.current;
      if (!scope || scope.editor !== editor || editor?.isDestroyed) return;
      const timer = setTimeout(() => {
        scope.timers.delete(timer);
        if (scopeRef.current === scope && !editor?.isDestroyed) callback();
      }, delay);
      scope.timers.add(timer);
    },
    [editor]
  );

  const onTargetFoundRef = useRef(onTargetFound);
  const onTargetNotFoundRef = useRef(onTargetNotFound);

  useEffect(() => {
    onTargetFoundRef.current = onTargetFound;
    onTargetNotFoundRef.current = onTargetNotFound;
  }, [onTargetFound, onTargetNotFound]);

  const scrollToNode = useCallback(
    (id: string): boolean => {
      if (!editor || editor.isDestroyed || scopeRef.current?.editor !== editor) return false;

      const attributeName =
        getEditorExtension(editor, "uniqueID")?.options?.attributeName ?? "data-id";
      let position: number | null = null;

      editor.state.doc.descendants((node, pos) => {
        if (node.attrs?.[attributeName] === id) {
          position = pos;
          return false;
        }
        return true;
      });

      if (position === null) return false;

      selectNodeAndHideFloating(editor, position);

      schedule(() => {
        const dom = editor.view.nodeDOM(position!) as HTMLElement | null;

        if (dom) {
          dom.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 0);

      return true;
    },
    [editor, schedule]
  );

  const handleScroll = useCallback(
    (delay = 0) => {
      const hash = window.location.hash?.substring(1);
      if (!hash) return;

      // Skip if we already scrolled to this exact hash
      if (hash === scopeRef.current?.lastProcessedHash) return;

      schedule(() => {
        if (window.location.hash.substring(1) !== hash) return;
        if (scrollToNode(hash)) {
          if (scopeRef.current) scopeRef.current.lastProcessedHash = hash;
          onTargetFoundRef.current(hash);
        } else {
          onTargetNotFoundRef.current(hash);
        }
      }, delay);
    },
    [scrollToNode, schedule]
  );

  useEffect(() => {
    if (!editor) return;

    // Handle collaboration sync or immediate scroll
    const provider = editor.extensionManager.extensions.find(
      (ext) => ext.name === "collaborationCaret"
    )?.options?.provider;

    if (provider?.on) {
      const syncHandler = () => handleScroll(500);
      provider.on("synced", syncHandler);

      return () => {
        provider.off?.("synced", syncHandler);
      };
    } else {
      handleScroll(500);
    }
  }, [editor, handleScroll]);

  useEffect(() => {
    const immediateScroll = () => handleScroll();
    const delayedScroll = () => handleScroll(500);

    window.addEventListener("hashchange", immediateScroll);
    window.addEventListener("pageshow", delayedScroll);
    window.addEventListener("popstate", immediateScroll);

    return () => {
      window.removeEventListener("hashchange", immediateScroll);
      window.removeEventListener("pageshow", delayedScroll);
      window.removeEventListener("popstate", immediateScroll);
    };
  }, [handleScroll]);

  return { scrollToHash: scrollToNode };
}
