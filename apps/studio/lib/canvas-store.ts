"use client";

/**
 * Local persistence for studio projects (IndexedDB).
 *
 * A *project* is the durable entity; `mode` is how it is edited. Today the only
 * mode is "canvas" (the node graph), but the entity is mode-agnostic so future
 * editing modes are just a different view over the same project — no data
 * model change. These function signatures are the contract: the internals can
 * swap to a server `/aurora/projects` API later — and, when team real-time
 * collaboration lands (WS / Ably), to a synced backend — without touching
 * callers. Keep this module's surface granular and side-effect-free so that
 * swap stays an implementation detail.
 *
 * Images are stored as Blobs (object URLs die on reload; data URLs blow the
 * localStorage quota).
 */

export type ProjectMode = "canvas";

export type ProjectMeta = {
  id: string;
  name: string;
  mode: ProjectMode;
  updatedAt: number;
};

type StoredNodeBase = {
  id: string;
  position: { x: number; y: number };
};

/** Schema-keyed model settings bag (matches the generation input shape). */
export type StoredGenSettings = Record<string, string | number | boolean>;

type StoredGenFields = {
  name?: string;
  prompt?: string;
  modelId?: string;
  modelName?: string;
  mode?: string;
  settings?: StoredGenSettings;
  // `references` are intentionally NOT persisted: they hold object URLs that
  // die on reload. Durable reference storage lands with SAS upload (the same
  // confirm-on-upload pipeline used for media), not local blobs.
};

export type StoredCanvasNode =
  | (StoredNodeBase & { kind: "image"; imageId: string; label?: string })
  | (StoredNodeBase & { kind: "note"; text: string })
  | (StoredNodeBase & { kind: "prompt" } & StoredGenFields)
  | (StoredNodeBase & { kind: "video" } & StoredGenFields);

export type StoredCanvasEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

/** A project plus its canvas-mode content. */
export type ProjectRecord = ProjectMeta & {
  nodes: StoredCanvasNode[];
  edges?: StoredCanvasEdge[];
};

const DB_NAME = "fizzstudio-canvas";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("projects")) {
        db.createObjectStore("projects", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("images")) {
        db.createObjectStore("images");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(
  store: string,
  mode: IDBTransactionMode,
  op: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = op(db.transaction(store, mode).objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** Records written before `mode` existed default to the canvas mode. */
function normalizeMeta<T extends { mode?: ProjectMode }>(record: T): T & { mode: ProjectMode } {
  return { ...record, mode: record.mode ?? "canvas" };
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await run<ProjectRecord[]>("projects", "readonly", (s) => s.getAll());
  return all
    .map(({ nodes: _nodes, edges: _edges, ...meta }) => normalizeMeta(meta))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createProject(opts?: {
  name?: string;
  mode?: ProjectMode;
}): Promise<ProjectMeta> {
  const record: ProjectRecord = {
    id: crypto.randomUUID(),
    name: opts?.name?.trim() || "Untitled canvas",
    mode: opts?.mode ?? "canvas",
    updatedAt: Date.now(),
    nodes: [],
  };
  await run("projects", "readwrite", (s) => s.put(record));
  const { nodes: _nodes, edges: _edges, ...meta } = record;
  return meta;
}

export async function getProject(id: string): Promise<ProjectRecord | undefined> {
  const record = await run<ProjectRecord | undefined>("projects", "readonly", (s) => s.get(id));
  return record ? normalizeMeta(record) : undefined;
}

export async function saveProjectContent(
  id: string,
  nodes: StoredCanvasNode[],
  edges: StoredCanvasEdge[]
): Promise<void> {
  const existing = await getProject(id);
  if (!existing) return;
  await run("projects", "readwrite", (s) =>
    s.put({ ...existing, nodes, edges, updatedAt: Date.now() })
  );
}

export async function renameProject(id: string, name: string): Promise<void> {
  const existing = await getProject(id);
  if (!existing) return;
  const next = name.trim();
  if (!next || next === existing.name) return;
  await run("projects", "readwrite", (s) =>
    s.put({ ...existing, name: next, updatedAt: Date.now() })
  );
}

export async function duplicateProject(id: string): Promise<ProjectMeta | undefined> {
  const source = await getProject(id);
  if (!source) return undefined;
  // Copy image blobs so the clone owns its own — otherwise deleting one project
  // would delete blobs the other still references.
  const remap = new Map<string, string>();
  for (const node of source.nodes) {
    if (node.kind === "image" && !remap.has(node.imageId)) {
      const blob = await getImage(node.imageId);
      if (blob) remap.set(node.imageId, await putImage(blob));
    }
  }
  const nodes = source.nodes.map((node) =>
    node.kind === "image" ? { ...node, imageId: remap.get(node.imageId) ?? node.imageId } : node
  );
  const record: ProjectRecord = {
    id: crypto.randomUUID(),
    name: `${source.name} copy`,
    mode: source.mode,
    updatedAt: Date.now(),
    nodes,
    edges: source.edges,
  };
  await run("projects", "readwrite", (s) => s.put(record));
  const { nodes: _nodes, edges: _edges, ...meta } = record;
  return meta;
}

export async function deleteProject(id: string): Promise<void> {
  const existing = await getProject(id);
  await run("projects", "readwrite", (s) => s.delete(id));
  if (!existing) return;
  const imageIds = [
    ...new Set(existing.nodes.flatMap((node) => (node.kind === "image" ? [node.imageId] : []))),
  ];
  await Promise.all(
    imageIds.map((imageId) => run("images", "readwrite", (s) => s.delete(imageId)))
  );
}

export async function putImage(blob: Blob): Promise<string> {
  const id = crypto.randomUUID();
  await run("images", "readwrite", (s) => s.put(blob, id));
  return id;
}

export async function getImage(id: string): Promise<Blob | undefined> {
  return run("images", "readonly", (s) => s.get(id));
}
