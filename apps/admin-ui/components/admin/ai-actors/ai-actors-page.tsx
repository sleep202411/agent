"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconMasksTheater,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { adminUiApiPath } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Actor = {
  id: string;
  name: string;
  photoAssetId: string;
  active: boolean;
  _count: { unlocks: number; uses: number };
};
type Usage = {
  id: string;
  userId: string;
  workspaceId: string;
  projectId: string;
  workspace: { name: string };
  project: { name: string };
  createdAt: string;
};
async function request<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(adminUiApiPath(`/api/admin/${path}`), {
    method: body === undefined ? "GET" : "POST",
    signal,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok || result.code !== 200)
    throw new Error(result.msg || result.message || `Request failed (${response.status})`);
  return result.data as T;
}
function useAdminRead<T>(path: string, revision: number) {
  const scope = `${path}:${revision}`;
  const [result, setResult] = useState<{ scope: string; data?: T; error?: string } | null>(null);
  useEffect(() => {
    const run = new AbortController();
    void request<T>(path, run.signal)
      .then((data) => {
        if (!run.signal.aborted) setResult({ scope, data });
      })
      .catch((e) => {
        if (!run.signal.aborted)
          setResult({ scope, error: e instanceof Error ? e.message : "Request failed." });
      });
    return () => run.abort();
  }, [path, scope]);
  return result?.scope === scope ? result : null;
}
export function AiActorsPage({ canWrite }: { canWrite: boolean }) {
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<Actor | "new" | null>(null);
  const [usage, setUsage] = useState<Actor | null>(null);
  const result = useAdminRead<{ items: Actor[]; total: number }>(`ai-actors?page=${page}`, refresh);
  const data = result?.data;
  const error = result?.error;
  return (
    <main className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <IconMasksTheater />
            AI Actors
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Curate original performers and see where teams use them.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            aria-label="Refresh actors"
            onClick={() => setRefresh((v) => v + 1)}
          >
            <IconRefresh className="size-4" />
          </Button>
          <Button disabled={!canWrite} onClick={() => setEditing("new")}>
            <IconPlus className="size-4" />
            Add actor
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Loading actors…</p>}
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-muted-foreground">
              <tr>
                {["Actor", "Availability", "Workspaces unlocked", "Reference uses", "Actions"].map(
                  (s) => (
                    <th className="p-3 font-medium" key={s}>
                      {s}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {data.items.map((actor) => (
                <tr key={actor.id} className="border-b">
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={adminUiApiPath(
                          `/api/admin/media/assets/${actor.photoAssetId}/content`
                        )}
                        alt={actor.name}
                        className="h-20 w-16 rounded-lg object-cover"
                      />
                      <span className="font-medium">{actor.name}</span>
                    </div>
                  </td>
                  <td className="p-3">{actor.active ? "Available" : "Hidden"}</td>
                  <td className="p-3 tabular-nums">{actor._count.unlocks}</td>
                  <td className="p-3 tabular-nums">{actor._count.uses}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!canWrite}
                        onClick={() => setEditing(actor)}
                      >
                        <IconPencil className="size-4" />
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setUsage(actor)}>
                        Usage
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.items.length === 0 && (
            <p className="py-12 text-center text-muted-foreground">
              No actors yet. Add a name and photo to get started.
            </p>
          )}
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Reference uses count issued Canvas references, not generated videos or credits spent.
        </p>
        <div className="flex items-center gap-3">
          <Button variant="ghost" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span>Page {page}</span>
          <Button
            variant="ghost"
            disabled={!data || page * 24 >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
      {editing && (
        <ActorEditor
          key={typeof editing === "string" ? editing : editing.id}
          actor={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setRefresh((v) => v + 1);
          }}
        />
      )}
      {usage && <UsageDialog key={usage.id} actor={usage} onClose={() => setUsage(null)} />}
    </main>
  );
}
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      className="m-auto max-h-[85vh] w-[min(720px,95vw)] overflow-auto rounded-xl bg-background p-6 text-foreground shadow-xl backdrop:bg-black/60"
      aria-label={title}
    >
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-semibold">{title}</h2>
        <Button variant="ghost" aria-label="Close" onClick={onClose}>
          <IconX className="size-4" />
        </Button>
      </div>
      {children}
    </dialog>
  );
}
function ActorEditor({
  actor,
  onClose,
  onSaved,
}: {
  actor: Actor | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(actor?.name ?? "");
  const [active, setActive] = useState(actor?.active ?? false);
  const [photo, setPhoto] = useState(actor?.photoAssetId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const runRef = useRef<AbortController | null>(null);
  useEffect(() => () => runRef.current?.abort(), []);
  async function execute(work: (signal: AbortSignal) => Promise<void>) {
    if (runRef.current) return;
    const run = new AbortController();
    runRef.current = run;
    setBusy(true);
    setError(null);
    try {
      await work(run.signal);
    } catch (e) {
      if (!run.signal.aborted) setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      if (!run.signal.aborted) {
        runRef.current = null;
        setBusy(false);
      }
    }
  }
  async function upload(file: File) {
    await execute(async (signal) => {
      const signed = await request<{
        uploadUrl: string;
        method: string;
        headers: Record<string, string>;
        storageKey: string;
      }>("media/upload-url", signal, {
        kind: "ai_reference_image",
        contentType: file.type,
        fileName: file.name,
        sizeBytes: file.size,
      });
      const response = await fetch(signed.uploadUrl, {
        method: signed.method,
        headers: signed.headers,
        body: file,
        signal,
      });
      if (!response.ok) throw new Error(`Photo upload failed (${response.status}).`);
      const confirmed = await request<{ mediaAssetId: string }>("media/confirm", signal, {
        kind: "ai_reference_image",
        storageKey: signed.storageKey,
        contentType: file.type,
      });
      signal.throwIfAborted();
      setPhoto(confirmed.mediaAssetId);
    });
  }
  return (
    <Modal title={actor ? "Edit actor" : "Add actor"} onClose={onClose}>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void execute(async (signal) => {
            await request("ai-actors", signal, {
              ...(actor ? { id: actor.id } : {}),
              name: name.trim(),
              photoAssetId: photo,
              active,
            });
            signal.throwIfAborted();
            onSaved();
          });
        }}
      >
        <label className="block space-y-2">
          <span className="text-sm font-medium">Actor name</span>
          <Input
            required
            maxLength={64}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="flex items-center gap-5">
          {/* Authenticated media redirects use the browser cookie. */}
          {/* eslint-disable @next/next/no-img-element */}
          {photo && (
            <img
              src={adminUiApiPath(`/api/admin/media/assets/${photo}/content`)}
              alt="Actor preview"
              className="h-44 w-32 rounded-lg object-cover"
            />
          )}
          <label className="block space-y-2">
            <span className="flex items-center gap-2 text-sm font-medium">
              <IconUpload className="size-4" />
              Actor photo
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void upload(file);
              }}
              className="block w-full text-sm"
            />
            <span className="block text-xs text-muted-foreground">
              PNG, JPEG or WebP · up to 30 MB
            </span>
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={active}
            disabled={busy}
            onChange={(e) => setActive(e.target.checked)}
          />
          Available in the AI Actor library
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !photo || !name.trim()}>
            {busy ? "Saving…" : "Save actor"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function UsageDialog({ actor, onClose }: { actor: Actor; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const result = useAdminRead<{ items: Usage[]; total: number }>(
    `ai-actors/${actor.id}/usage?page=${page}`,
    retry
  );
  const data = result?.data;
  const error = result?.error;
  return (
    <Modal title={`${actor.name} · Reference uses`} onClose={onClose}>
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <Button onClick={() => setRetry((v) => v + 1)}>Retry</Button>
        </div>
      ) : !data ? (
        <p>Loading usage…</p>
      ) : (
        <>
          <div className="space-y-4">
            {data.items.map((row) => (
              <div key={row.id} className="border-b pb-3 text-sm">
                <div className="font-medium">
                  {row.workspace.name} / {row.project.name}
                </div>
                <p className="text-muted-foreground">
                  User {row.userId} · {new Date(row.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
            {data.items.length === 0 && (
              <p className="text-muted-foreground">No reference uses recorded yet.</p>
            )}
          </div>
        </>
      )}
      <div className="mt-5 flex justify-between">
        <Button variant="ghost" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <span>Page {page}</span>
        <Button
          variant="ghost"
          disabled={!data || page * 24 >= data.total}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </Modal>
  );
}
