"use client";
import { adminUiApiPath } from "@/lib/admin-api";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
type Field = {
  key: string;
  label: string;
  instructions: string;
  type: "text" | "attachment";
  required: boolean;
};
type Definition = {
  categoryKey?: string;
  approvalPolicy?: "standard" | "fd3_or_production_lead";
  name: string;
  description: string;
  status: "active" | "archived";
  prices: { currency: "USD" | "CNY"; amountMinor: string; unit: string }[];
  fields: Field[];
};
type Category = { id: string; version: number; definition: Definition };
type Page = { items: Category[]; nextCursor: string | null };
async function request<T>(path: string, signal: AbortSignal, data?: unknown): Promise<T> {
  const response = await fetch(adminUiApiPath(path), {
    method: data ? "POST" : "GET",
    signal,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await response.json();
  if (!response.ok || result.code !== 200)
    throw new Error(result.message ?? result.msg ?? `Request failed (${response.status})`);
  return result.data;
}
export function DeliveryCatalogPanel() {
  const [rows, setRows] = useState<Category[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [draft, setDraft] = useState<Category | null>(null);
  const [reason, setReason] = useState(""),
    [pending, setPending] = useState(true),
    [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  async function load(next?: string) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError(null);
    try {
      const page = await request<Page>(
        `/api/admin/crew-delivery-catalog?limit=50${next ? `&cursor=${encodeURIComponent(next)}` : ""}`,
        controller.signal
      );
      if (!controller.signal.aborted) {
        setRows((previous) =>
          next
            ? [
                ...previous,
                ...page.items.filter((row) => !previous.some((old) => old.id === row.id)),
              ]
            : page.items
        );
        setCursor(page.nextCursor);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (active.current === controller) {
        active.current = null;
        setPending(false);
      }
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    request<Page>("/api/admin/crew-delivery-catalog?limit=50", controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) {
          setRows(page.items);
          setCursor(page.nextCursor);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active.current === controller) {
          active.current = null;
          setPending(false);
        }
      });
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, []);
  function change(patch: Partial<Definition>) {
    setDraft((previous) =>
      previous ? { ...previous, definition: { ...previous.definition, ...patch } } : null
    );
  }
  function field(index: number, patch: Partial<Field>) {
    if (draft)
      change({
        fields: draft.definition.fields.map((value, i) =>
          i === index ? { ...value, ...patch } : value
        ),
      });
  }
  async function save() {
    if (active.current || !draft) return;
    const catKey = draft.definition.categoryKey?.trim();
    if (catKey && !/^[a-z][a-z0-9_]{0,47}$/.test(catKey)) {
      setError("Category key must be lowercase snake_case.");
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError(null);
    try {
      const saved = await request<Category>(
        `/api/admin/crew-delivery-catalog/${draft.id}`,
        controller.signal,
        { expectedVersion: draft.version, reason: reason.trim(), definition: draft.definition }
      );
      if (!controller.signal.aborted) {
        setRows((previous) => [saved, ...previous.filter((row) => row.id !== saved.id)]);
        setDraft(saved);
        setReason("");
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (active.current === controller) {
        active.current = null;
        setPending(false);
      }
    }
  }
  const inputClass = "w-full rounded border border-slate-300 bg-transparent p-2 text-sm";
  return (
    <main className="space-y-4 p-5">
      <h1 className="text-xl font-semibold">交付标准</h1>
      <p className="text-sm text-slate-500">
        Reference prices and delivery requirements. Changes do not rewrite agreed task compensation.
      </p>
      <div className="flex gap-2">
        <Button disabled={pending} onClick={() => void load()}>
          Refresh / retry
        </Button>
        <Button
          disabled={pending}
          onClick={() => {
            setDraft({
              id: crypto.randomUUID(),
              version: 0,
              definition: { name: "", description: "", status: "active", prices: [], fields: [] },
            });
            setReason("");
            setError(null);
          }}
        >
          New category
        </Button>
      </div>
      {pending ? <p role="status">Loading / saving…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="max-w-full overflow-x-auto">
        <table className="w-full text-left text-sm [&_th]:px-2 [&_td]:px-2 [&_td]:py-2">
          <caption className="text-left">Categories</caption>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Revision</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td>{row.definition.name}</td>
                <td>{row.definition.status}</td>
                <td>{row.version}</td>
                <td>
                  <Button
                    aria-label={`Edit ${row.definition.name}`}
                    disabled={pending}
                    onClick={() => {
                      setDraft(structuredClone(row));
                      setReason("");
                    }}
                  >
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!pending && !rows.length ? <p>No categories configured.</p> : null}
      {cursor ? (
        <Button disabled={pending} onClick={() => void load(cursor)}>
          Load more
        </Button>
      ) : null}
      {draft ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="space-y-3"
        >
          <h2 className="font-semibold">
            {draft.version ? `Edit revision ${draft.version}` : "New category"}
          </h2>
          <fieldset disabled={pending} className="space-y-3">
            <div className="space-y-1">
              <label className="block">
                Category key
                <input
                  className={inputClass}
                  placeholder="e.g. storyboard_delivery"
                  value={draft.definition.categoryKey ?? ""}
                  maxLength={48}
                  onChange={(e) => change({ categoryKey: e.target.value.trim() || undefined })}
                />
              </label>
              {!draft.definition.categoryKey && (
                <p className="text-xs text-amber-500">
                  Set a category key to enable task binding for this category.
                </p>
              )}
            </div>
            <label className="block">
              Acceptance approval
              <select
                className={inputClass}
                value={draft.definition.approvalPolicy ?? "standard"}
                onChange={(e) =>
                  change({ approvalPolicy: e.target.value as Definition["approvalPolicy"] })
                }
              >
                <option value="standard">Standard task review</option>
                <option value="fd3_or_production_lead">
                  Card generation: FD3 or qualified production-lead fallback
                </option>
              </select>
            </label>
            <p className="text-xs text-muted-foreground">
              For card generation, the production lead can approve only if the project has no
              FD3-or-higher member and exactly one assigned card artist. Existing tasks retain their
              agreed template revision.
            </p>
            <label className="block">
              Category name
              <input
                className={inputClass}
                value={draft.definition.name}
                required
                maxLength={120}
                onChange={(e) => change({ name: e.target.value })}
              />
            </label>
            <label className="block">
              Description
              <textarea
                className={inputClass}
                value={draft.definition.description}
                maxLength={2000}
                onChange={(e) => change({ description: e.target.value })}
              />
            </label>
            <label className="block">
              Status
              <select
                className={inputClass}
                value={draft.definition.status}
                onChange={(e) => change({ status: e.target.value as Definition["status"] })}
              >
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <h3 className="font-medium">Reference prices</h3>
            {(["USD", "CNY"] as const).map((currency) => {
              const price = draft.definition.prices.find((row) => row.currency === currency);
              return (
                <div key={currency} className="space-y-2">
                  <label>
                    <input
                      type="checkbox"
                      checked={!!price}
                      onChange={(e) =>
                        change({
                          prices: e.target.checked
                            ? [...draft.definition.prices, { currency, amountMinor: "", unit: "" }]
                            : draft.definition.prices.filter((row) => row.currency !== currency),
                        })
                      }
                    />{" "}
                    Configure {currency} reference price
                  </label>
                  {price ? (
                    <>
                      <label className="block">
                        {currency} amount in minor units
                        <input
                          className={inputClass}
                          inputMode="numeric"
                          pattern="(0|[1-9][0-9]{0,14})"
                          required
                          value={price.amountMinor}
                          onChange={(e) =>
                            change({
                              prices: draft.definition.prices.map((row) =>
                                row.currency === currency
                                  ? { ...row, amountMinor: e.target.value }
                                  : row
                              ),
                            })
                          }
                        />
                      </label>
                      <label className="block">
                        {currency} pricing unit
                        <input
                          className={inputClass}
                          required
                          maxLength={100}
                          value={price.unit}
                          onChange={(e) =>
                            change({
                              prices: draft.definition.prices.map((row) =>
                                row.currency === currency ? { ...row, unit: e.target.value } : row
                              ),
                            })
                          }
                        />
                      </label>
                    </>
                  ) : null}
                </div>
              );
            })}
            <h3 className="font-medium">Delivery fields</h3>
            {draft.definition.fields.map((value, index) => (
              <div key={index} className="grid gap-2 border-t py-3 sm:grid-cols-2">
                <label>
                  Field key
                  <input
                    className={inputClass}
                    required
                    pattern="[a-z][a-z0-9_]{0,47}"
                    value={value.key}
                    onChange={(e) => field(index, { key: e.target.value })}
                  />
                </label>
                <label>
                  Field label
                  <input
                    className={inputClass}
                    required
                    maxLength={120}
                    value={value.label}
                    onChange={(e) => field(index, { label: e.target.value })}
                  />
                </label>
                <label>
                  Type
                  <select
                    className={inputClass}
                    value={value.type}
                    onChange={(e) => field(index, { type: e.target.value as Field["type"] })}
                  >
                    <option value="text">Text</option>
                    <option value="attachment">Attachment</option>
                  </select>
                </label>
                <label>
                  Instructions
                  <textarea
                    className={inputClass}
                    maxLength={1000}
                    value={value.instructions}
                    onChange={(e) => field(index, { instructions: e.target.value })}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={value.required}
                    onChange={(e) => field(index, { required: e.target.checked })}
                  />{" "}
                  Required
                </label>
                <Button
                  type="button"
                  onClick={() =>
                    change({ fields: draft.definition.fields.filter((_, i) => i !== index) })
                  }
                >
                  Remove field {index + 1}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              disabled={draft.definition.fields.length >= 40}
              onClick={() =>
                change({
                  fields: [
                    ...draft.definition.fields,
                    { key: "", label: "", instructions: "", type: "text", required: false },
                  ],
                })
              }
            >
              Add field
            </Button>
            <label className="block">
              Change reason
              <textarea
                className={inputClass}
                required
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <Button type="submit" disabled={!reason.trim() || !draft.definition.fields.length}>
              Save revision
            </Button>
          </fieldset>
        </form>
      ) : null}
    </main>
  );
}
