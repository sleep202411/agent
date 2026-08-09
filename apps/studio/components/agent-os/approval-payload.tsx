"use client";

import { useState } from "react";

/**
 * What the agent is about to write, rendered so a person can judge it.
 *
 * The approval gate exists for exactly one purpose — letting the user decide
 * whether this change should happen — and a card showing only a tool id cannot
 * serve it: a 200-shot overwrite and a one-line note look identical. The
 * arguments are already on the message; this reads them.
 *
 * Destructive counts are called out first. Everything else is a compact list
 * with the full payload one click away, because the point is a decision, not a
 * code review.
 */
export type ApprovalPayloadLabels = {
  /** e.g. "Creates {count}" */
  creates: (count: number) => string;
  updates: (count: number) => string;
  deletes: (count: number) => string;
  andMore: (count: number) => string;
  showDetails: string;
  hideDetails: string;
  untitled: string;
  storyBible: string;
  storyEntry: string;
  sceneOrder: string;
  storyScene: string;
};

type Row = { key: string; title: string; note?: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** First localized value of a `{ "zh-CN": "林黛玉" }`-shaped name. */
function localizedName(value: unknown): string {
  const record = asRecord(value);
  for (const candidate of Object.values(record)) {
    const text = str(candidate);
    if (text) return text;
  }
  return "";
}

type Summary = {
  creates: Row[];
  updates: Row[];
  deletes: Row[];
  /** Tools we do not have a shape for still show their raw payload. */
  recognized: boolean;
};

function summarize(toolId: string, args: unknown, labels: ApprovalPayloadLabels): Summary {
  const empty: Summary = { creates: [], updates: [], deletes: [], recognized: false };
  const payload = asRecord(args);

  if (toolId === "storyboard.upsertShots") {
    const shots = Array.isArray(payload.shots) ? payload.shots : [];
    const summary: Summary = { creates: [], updates: [], deletes: [], recognized: true };
    for (const raw of shots) {
      const shot = asRecord(raw);
      const id = str(shot.id);
      const row: Row = {
        key: id,
        title: str(shot.title) || id,
        note: str(shot.prompt) || str(shot.description) || undefined,
      };
      if (str(shot.intent) === "replace") summary.updates.push(row);
      else summary.creates.push(row);
    }
    return summary;
  }

  if (toolId === "storyboard.deleteShots") {
    const ids = Array.isArray(payload.shotIds) ? payload.shotIds : [];
    return {
      creates: [],
      updates: [],
      deletes: ids.map((id) => ({ key: str(id), title: str(id) })),
      recognized: true,
    };
  }

  if (toolId === "characters.upsert") {
    const characters = Array.isArray(payload.characters) ? payload.characters : [];
    const summary: Summary = { creates: [], updates: [], deletes: [], recognized: true };
    for (const raw of characters) {
      const character = asRecord(raw);
      const id = str(character.id);
      const row: Row = {
        key: id,
        title: localizedName(character.name) || id,
        note: str(character.summary) || undefined,
      };
      if (str(character.intent) === "replace") summary.updates.push(row);
      else summary.creates.push(row);
    }
    return summary;
  }

  if (toolId === "canvas.applyPatch") {
    const operations = Array.isArray(payload.operations) ? payload.operations : [];
    return {
      creates: [],
      updates: operations.map((raw, index) => {
        const operation = asRecord(raw);
        return {
          key: str(operation.operationId) || `op-${index}`,
          title: str(operation.kind) || `operation ${index + 1}`,
        };
      }),
      deletes: [],
      recognized: true,
    };
  }

  if (toolId === "story.addScene") {
    const scene = asRecord(payload.scene);
    const id = str(scene.nodeId);
    return {
      creates: [
        { key: id, title: str(scene.name) || id, note: str(scene.description) || undefined },
      ],
      updates: payload.afterNodeId
        ? [{ key: str(payload.afterNodeId), title: str(payload.afterNodeId) }]
        : [],
      deletes: [],
      recognized: true,
    };
  }

  if (toolId === "story.addBranch") {
    const branches = Array.isArray(payload.branches) ? payload.branches : [];
    return {
      creates: branches.map((raw, index) => {
        const scene = asRecord(asRecord(raw).scene);
        const id = str(scene.nodeId) || `branch-${index}`;
        return {
          key: id,
          title: str(scene.name) || id,
          note: localizedName(asRecord(raw).label) || str(scene.description) || undefined,
        };
      }),
      updates: [
        { key: str(payload.afterNodeId), title: str(payload.afterNodeId) || labels.storyScene },
      ],
      deletes: [],
      recognized: true,
    };
  }

  if (toolId === "story.updateBible") {
    const putCharacters = Array.isArray(payload.putCharacters) ? payload.putCharacters : [];
    const removeIds = Array.isArray(payload.removeCharacterIds) ? payload.removeCharacterIds : [];
    const summary: Summary = { creates: [], updates: [], deletes: [], recognized: true };
    for (const raw of putCharacters) {
      const write = asRecord(raw);
      const character = asRecord(write.character);
      const id = str(character.id);
      const row = {
        key: id,
        title: localizedName(character.name) || id,
        note: str(character.summary) || undefined,
      };
      if (str(write.intent) === "create") summary.creates.push(row);
      else summary.updates.push(row);
    }
    summary.deletes.push(...removeIds.map((id) => ({ key: str(id), title: str(id) })));
    if (
      payload.logline !== undefined ||
      payload.synopsis !== undefined ||
      payload.productionNotes !== undefined
    ) {
      summary.updates.unshift({
        key: "story-bible",
        title: labels.storyBible,
        note: str(payload.logline) || str(payload.synopsis) || undefined,
      });
    }
    return summary;
  }

  if (toolId === "story.editNode") {
    const id = str(payload.nodeId);
    return {
      creates: [],
      updates: [
        { key: id, title: str(payload.name) || id, note: str(payload.description) || undefined },
      ],
      deletes: [],
      recognized: true,
    };
  }

  if (toolId === "story.removeSubtree") {
    const id = str(payload.nodeId);
    return {
      creates: [],
      updates: [],
      deletes: [{ key: id, title: id }],
      recognized: true,
    };
  }

  if (toolId === "story.setEntry" || toolId === "story.reorder") {
    return {
      creates: [],
      updates: [
        {
          key: toolId,
          title: toolId === "story.setEntry" ? labels.storyEntry : labels.sceneOrder,
        },
      ],
      deletes: [],
      recognized: true,
    };
  }

  if (toolId === "story.applyPatch") {
    const operations = Array.isArray(payload.operations) ? payload.operations : [];
    return {
      creates: [],
      updates: operations.map((raw, index) => {
        const operation = asRecord(raw);
        return {
          key: str(operation.operationId) || `op-${index}`,
          title: str(operation.kind) || `operation ${index + 1}`,
        };
      }),
      deletes: [],
      recognized: true,
    };
  }

  return empty;
}

const PREVIEW_LIMIT = 6;

function RowList({
  rows,
  tone,
  heading,
  labels,
}: {
  rows: Row[];
  tone: "neutral" | "danger";
  heading: string;
  labels: ApprovalPayloadLabels;
}) {
  if (rows.length === 0) return null;
  const shown = rows.slice(0, PREVIEW_LIMIT);
  const hidden = rows.length - shown.length;
  return (
    <div className="mt-1.5">
      <p
        className={
          tone === "danger"
            ? "text-[11px] font-medium text-red-200"
            : "text-[11px] font-medium text-white/62"
        }
      >
        {heading}
      </p>
      <ul className="mt-0.5 space-y-0.5">
        {shown.map((row) => (
          <li key={row.key} className="text-[11px] leading-snug text-white/70">
            <span className={tone === "danger" ? "text-red-200/90" : undefined}>
              {row.title || labels.untitled}
            </span>
            {row.note ? <span className="text-white/35"> — {truncate(row.note, 80)}</span> : null}
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <p className="mt-0.5 text-[11px] text-white/35">{labels.andMore(hidden)}</p>
      ) : null}
    </div>
  );
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function ApprovalPayload({
  toolId,
  args,
  labels,
}: {
  toolId: string;
  args: unknown;
  labels: ApprovalPayloadLabels;
}) {
  const [open, setOpen] = useState(false);
  if (args === undefined || args === null) return null;

  const summary = summarize(toolId, args, labels);
  const hasRows = summary.creates.length + summary.updates.length + summary.deletes.length > 0;

  return (
    <div className="mt-2">
      {/* Deletions first: they are the change a user most needs to catch. */}
      <RowList
        rows={summary.deletes}
        tone="danger"
        heading={labels.deletes(summary.deletes.length)}
        labels={labels}
      />
      <RowList
        rows={summary.updates}
        tone="neutral"
        heading={labels.updates(summary.updates.length)}
        labels={labels}
      />
      <RowList
        rows={summary.creates}
        tone="neutral"
        heading={labels.creates(summary.creates.length)}
        labels={labels}
      />

      {/* An unrecognized tool still shows its payload rather than nothing. */}
      {!hasRows && !summary.recognized ? (
        <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-black/30 p-2 text-[10px] leading-relaxed text-white/55">
          {safeJson(args)}
        </pre>
      ) : null}

      {hasRows ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="mt-1.5 text-[11px] text-white/45 underline underline-offset-2 hover:text-white/70"
          >
            {open ? labels.hideDetails : labels.showDetails}
          </button>
          {open ? (
            <pre className="mt-1 max-h-56 overflow-auto rounded-lg bg-black/30 p-2 text-[10px] leading-relaxed text-white/55">
              {safeJson(args)}
            </pre>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}
