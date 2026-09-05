/**
 * Summarize Agent OS tool approval arguments for mobile HITL UI.
 * Mirrors `apps/studio/components/agent-os/approval-payload.tsx`.
 */

export type ApprovalPayloadLabels = {
  creates: (count: number) => string;
  updates: (count: number) => string;
  deletes: (count: number) => string;
  andMore: (count: number) => string;
  untitled: string;
  storyBible: string;
  storyEntry: string;
  sceneOrder: string;
  storyScene: string;
  generationBatch: string;
  generationBatchSummary: (count: number, points: number) => string;
};

type Row = { key: string; title: string; note?: string };

export type ApprovalSummary = {
  creates: Row[];
  updates: Row[];
  deletes: Row[];
  decision?: Row;
  recognized: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function localizedName(value: unknown): string {
  const record = asRecord(value);
  for (const candidate of Object.values(record)) {
    const text = str(candidate);
    if (text) return text;
  }
  return "";
}

export function summarizeApprovalPayload(
  toolId: string,
  args: unknown,
  labels: ApprovalPayloadLabels
): ApprovalSummary {
  const empty: ApprovalSummary = { creates: [], updates: [], deletes: [], recognized: false };
  const payload = asRecord(args);

  if (toolId === "storyboard.upsertShots") {
    const shots = Array.isArray(payload.shots) ? payload.shots : [];
    const summary: ApprovalSummary = { creates: [], updates: [], deletes: [], recognized: true };
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
    const summary: ApprovalSummary = { creates: [], updates: [], deletes: [], recognized: true };
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
    const summary: ApprovalSummary = { creates: [], updates: [], deletes: [], recognized: true };
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

  if (toolId === "story.generation.confirmBatch") {
    const count =
      typeof payload.expectedItemCount === "number" && Number.isInteger(payload.expectedItemCount)
        ? payload.expectedItemCount
        : 0;
    const points =
      typeof payload.expectedTotalPoints === "number" &&
      Number.isInteger(payload.expectedTotalPoints)
        ? payload.expectedTotalPoints
        : 0;
    return {
      creates: [],
      updates: [],
      deletes: [],
      decision: {
        key: str(payload.batchId) || toolId,
        title: labels.generationBatch,
        note: labels.generationBatchSummary(count, points),
      },
      recognized: true,
    };
  }

  return empty;
}

export function truncateApprovalNote(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function safeApprovalJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}
