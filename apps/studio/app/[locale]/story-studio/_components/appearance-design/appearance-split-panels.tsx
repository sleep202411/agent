"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import styles from "./appearance-preview.module.css";

const STORAGE_KEY = "fizzdragon.appearance.panel-layout.v1";
const DEFAULT_LAYOUT = { horizontal: 0.72, vertical: 0.48 };
const HANDLE_SIZE = 8;

function limits(length: number, vertical: boolean) {
  const available = Math.max(1, length - HANDLE_SIZE);
  const previewMin = vertical ? 200 : 320;
  const chatMin = vertical ? 240 : 300;
  // Short viewports still fit both panels; neither can disappear.
  const scale = Math.min(1, available / (previewMin + chatMin));
  return { min: (previewMin * scale) / available, max: 1 - (chatMin * scale) / available };
}
function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Layout state stays here so dragging does not rerender the player or chat. */
export function AppearanceSplitPanels({
  preview,
  chat,
  previewId,
  chatVisible = true,
}: {
  preview: ReactNode;
  chat: ReactNode;
  previewId: string;
  chatVisible?: boolean;
}) {
  const t = useTranslations("appearancePreview");
  const container = useRef<HTMLElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  const preferences = useRef(DEFAULT_LAYOUT);
  const drag = useRef<{
    pointerId: number;
    before: typeof DEFAULT_LAYOUT;
    vertical: boolean;
  } | null>(null);
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  const [size, setSize] = useState({ width: 0, height: 0, vertical: false });
  const [dragging, setDragging] = useState(false);
  const horizontalBounds = limits(size.width, false);
  const verticalBounds = limits(size.height, true);
  const horizontal = size.width
    ? clamp(layout.horizontal, horizontalBounds.min, horizontalBounds.max)
    : layout.horizontal;
  const vertical = size.height
    ? clamp(layout.vertical, verticalBounds.min, verticalBounds.max)
    : layout.vertical;
  const bounds = !size.width
    ? { min: 0, max: 1 }
    : size.vertical
      ? verticalBounds
      : horizontalBounds;
  const ratio = size.vertical ? vertical : horizontal;

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences.current));
    } catch {
      /* Layout remains usable when browser storage is unavailable. */
    }
  }
  function change(value: number, isVertical = size.vertical) {
    const key = isVertical ? "vertical" : "horizontal";
    preferences.current = { ...preferences.current, [key]: value };
    setLayout(preferences.current);
  }
  function finish() {
    const current = drag.current;
    drag.current = null;
    setDragging(false);
    if (current && handle.current?.hasPointerCapture(current.pointerId))
      handle.current.releasePointerCapture(current.pointerId);
    save();
  }

  useLayoutEffect(() => {
    const element = container.current!;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      const isVertical = window.matchMedia("(max-width: 780px)").matches;
      setSize({ width: rect.width, height: rect.height, vertical: isVertical });
      if (drag.current && drag.current.vertical !== isVertical) {
        const pointerId = drag.current.pointerId;
        drag.current = null;
        setDragging(false);
        if (handle.current?.hasPointerCapture(pointerId))
          handle.current.releasePointerCapture(pointerId);
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const frame = requestAnimationFrame(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
        if (
          saved &&
          [saved.horizontal, saved.vertical].every(
            (value) => typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1
          )
        ) {
          preferences.current = { horizontal: saved.horizontal, vertical: saved.vertical };
          setLayout(preferences.current);
        }
      } catch {
        /* Ignore invalid or unavailable layout preferences. */
      }
      measure();
    });
    const stop = () => {
      if (!drag.current) return;
      const pointerId = drag.current?.pointerId;
      drag.current = null;
      setDragging(false);
      if (pointerId !== undefined && handle.current?.hasPointerCapture(pointerId))
        handle.current.releasePointerCapture(pointerId);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences.current));
      } catch {
        /* Keep the in-memory layout. */
      }
    };
    window.addEventListener("blur", stop);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("blur", stop);
    };
  }, []);

  return (
    <main
      ref={container}
      className={styles.workspace}
      data-dragging={dragging || undefined}
      data-chat-hidden={!chatVisible || undefined}
      style={
        {
          "--preview-width": `${horizontal}fr`,
          "--chat-width": `${1 - horizontal}fr`,
          "--preview-height": `${vertical}fr`,
          "--chat-height": `${1 - vertical}fr`,
        } as CSSProperties
      }
    >
      {preview}
      <div
        ref={handle}
        role="separator"
        tabIndex={chatVisible ? 0 : -1}
        hidden={!chatVisible}
        className={styles.resizeHandle}
        aria-label={t("resizePanels")}
        aria-controls={previewId}
        title={t("resizePanelsHint")}
        aria-orientation={size.vertical ? "horizontal" : "vertical"}
        aria-valuemin={Math.round(bounds.min * 100)}
        aria-valuemax={Math.round(bounds.max * 100)}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuetext={t("panelSize", { percent: Math.round(ratio * 100) })}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0 || !container.current) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            pointerId: event.pointerId,
            before: preferences.current,
            vertical: size.vertical,
          };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointerId !== event.pointerId || !container.current) return;
          const rect = container.current.getBoundingClientRect();
          const length = current.vertical ? rect.height : rect.width;
          const offset = current.vertical ? event.clientY - rect.top : event.clientX - rect.left;
          const { min, max } = limits(length, current.vertical);
          change(
            clamp((offset - HANDLE_SIZE / 2) / Math.max(1, length - HANDLE_SIZE), min, max),
            current.vertical
          );
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={() => {
          if (drag.current) finish();
        }}
        onDoubleClick={() => {
          change(size.vertical ? DEFAULT_LAYOUT.vertical : DEFAULT_LAYOUT.horizontal);
          save();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && drag.current) {
            preferences.current = drag.current.before;
            setLayout(preferences.current);
            finish();
            event.preventDefault();
            return;
          }
          const backward = size.vertical ? "ArrowUp" : "ArrowLeft";
          const forward = size.vertical ? "ArrowDown" : "ArrowRight";
          const delta = event.shiftKey ? 0.1 : 0.02;
          const next =
            event.key === backward
              ? ratio - delta
              : event.key === forward
                ? ratio + delta
                : event.key === "Home"
                  ? bounds.min
                  : event.key === "End"
                    ? bounds.max
                    : null;
          if (next === null) return;
          event.preventDefault();
          change(clamp(next, bounds.min, bounds.max));
          save();
        }}
      >
        <span aria-hidden="true" />
      </div>
      <div className={styles.chatContainer} hidden={!chatVisible}>
        {chat}
      </div>
      {dragging && <div className={styles.dragShield} aria-hidden="true" />}
    </main>
  );
}
