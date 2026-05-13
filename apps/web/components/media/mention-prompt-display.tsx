"use client";

import { useMemo } from "react";
import { env } from "@/src/env";

/**
 * Read-only renderer for prompt strings that may contain `<mention>`
 * tags (the storyboard's character / scene / prop references). Edit
 * sites use the Tiptap `RichMentionEditor`; this is the display-only
 * counterpart so previews don't leak raw HTML markup at users.
 *
 * Wire shape (matches `mention-node.tsx#renderHTML`):
 *   <mention id="126" type="character" imgUrl="...">阿达拉姆</mention>
 *
 * Attribute names from the backend can be `imgUrl` or lowercase
 * `imgurl` — `getAttribute` lookups normalize to lowercase so both
 * work without an extra fallback.
 */

interface Segment {
  kind: "text" | "mention";
  text?: string;
  id?: string;
  type?: string;
  label?: string;
  imgUrl?: string;
}

function ossUrl(path: string): string {
  if (!path) return "";
  if (/^(https?:|blob:|data:)/.test(path)) return path;
  return `${env.OSS_BASE_URL}/${path}`;
}

function parsePromptHtml(html: string): Segment[] {
  if (typeof window === "undefined" || !html) {
    return [{ kind: "text", text: html }];
  }
  const doc = new DOMParser().parseFromString(`<root>${html}</root>`, "text/html");
  const root = doc.querySelector("root");
  if (!root) return [{ kind: "text", text: html }];

  const segments: Segment[] = [];
  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text) segments.push({ kind: "text", text });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (el.tagName.toLowerCase() === "mention") {
      segments.push({
        kind: "mention",
        id: el.getAttribute("id") ?? "",
        type: el.getAttribute("type") ?? "character",
        label: el.textContent ?? "",
        imgUrl: el.getAttribute("imgurl") ?? "",
      });
      return;
    }
    // Unknown element: render its text content as plain text so we
    // never silently drop user-visible characters.
    const text = el.textContent ?? "";
    if (text) segments.push({ kind: "text", text });
  });
  return segments;
}

export function MentionPromptDisplay({
  prompt,
  className,
}: {
  prompt: string;
  className?: string;
}) {
  const segments = useMemo(() => parsePromptHtml(prompt), [prompt]);

  return (
    <p className={className ?? "whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground"}>
      {segments.map((seg, i) => {
        if (seg.kind === "text") return <span key={i}>{seg.text}</span>;
        return (
          <span
            key={i}
            className="mx-0.5 inline-flex items-center gap-1 rounded-full bg-secondary/80 py-0.5 pl-0.5 pr-2 align-middle text-[11px] text-foreground"
          >
            {seg.imgUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ossUrl(seg.imgUrl)} alt="" className="size-4 rounded-full object-cover" />
            ) : (
              <span className="size-4 rounded-full bg-muted" />
            )}
            <span className="max-w-[120px] truncate">{seg.label}</span>
          </span>
        );
      })}
    </p>
  );
}
