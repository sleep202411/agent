import { z } from "zod";
import type { AiFieldDescriptor } from "./schema";

export const referenceBinding = z.object({
  refId: z.string().min(1),
  kind: z.literal("image"),
  label: z.string().min(1),
  order: z.number().int().positive(),
  url: z.string().url(),
  assetId: z.string().optional(),
});
export const promptDocument = z.object({
  version: z.literal(1),
  nodes: z.array(
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({
        type: z.literal("asset_ref"),
        refId: z.string().min(1),
        label: z.string().optional(),
      }),
    ])
  ),
});
export type ImageReference = {
  url: string;
  refId?: string;
  label?: string;
  assetId?: string;
  [key: string]: unknown;
};
export function objectImageField(descriptor: AiFieldDescriptor) {
  const { field, ui } = descriptor;
  return (
    field.type === "array" &&
    field.items.type === "object" &&
    field.items.properties.url?.type === "string" &&
    (ui.control === "image_upload" ||
      ui.accept?.split(",").some((x) => x.trim().startsWith("image/")) === true)
  );
}
/** Strict read: malformed saved input must remain editable, never silently reset. */
export function imageReferences(raw: unknown): ImageReference[] {
  const value = typeof raw === "string" ? JSON.parse(raw || "[]") : (raw ?? []);
  return z
    .array(
      z
        .object({
          url: z.string(),
          refId: z.string().optional(),
          label: z.string().optional(),
          assetId: z.string().optional(),
        })
        .passthrough()
    )
    .parse(value);
}
export function imageLabel(row: ImageReference, index: number) {
  return row.label || `Image${index + 1}`;
}
export function nextImageLabel(rows: ImageReference[], prompt: unknown = "") {
  const labels = new Set(rows.map(imageLabel));
  if (typeof prompt === "string")
    for (const match of prompt.matchAll(/@Image\d+/g)) labels.add(match[0].slice(1));
  let n = 1;
  while (labels.has(`Image${n}`)) n++;
  return `Image${n}`;
}
/** Freeze aliases/identities before editing the order; old drafts remain compatible. */
export function identifiedImages(rows: ImageReference[]) {
  return rows.map((row, index) => ({
    ...row,
    refId: row.refId || row.assetId || `image:${index + 1}`,
    label: imageLabel(row, index),
  }));
}
export function uniqueReferences(refs: z.infer<typeof referenceBinding>[]) {
  for (const key of ["refId", "label", "url", "assetId"] as const) {
    const values = refs.map((r) => r[key]).filter(Boolean);
    if (new Set(values).size !== values.length) return false;
  }
  return true;
}
/** Metadata travels in bindings even when the provider schema permits only URLs. */
export function referenceInputValues(fields: AiFieldDescriptor[], raw: Record<string, unknown>) {
  const values = { ...raw };
  for (const descriptor of fields) {
    const field = descriptor.field;
    if (
      !objectImageField(descriptor) ||
      field.type !== "array" ||
      field.items.type !== "object" ||
      field.items.additionalProperties !== false
    )
      continue;
    const properties = field.items.properties;
    values[descriptor.name] = imageReferences(raw[descriptor.name]).map((row) =>
      Object.fromEntries(
        Object.entries(row).filter(
          ([key]) => !["refId", "label", "assetId"].includes(key) || key in properties
        )
      )
    );
  }
  return values;
}
export function buildReferenceContract(
  input: Record<string, unknown>,
  messages?: { missing: (label: string) => string; duplicate: string }
) {
  const rows = identifiedImages(imageReferences(input.referenceImages));
  const references = rows.map((row, index) =>
    referenceBinding.parse({
      refId: row.refId,
      kind: "image",
      label: row.label,
      order: index + 1,
      url: row.url,
      ...(row.assetId ? { assetId: row.assetId } : {}),
    })
  );
  if (!uniqueReferences(references))
    throw new Error(
      messages?.duplicate ?? "Each reference image must have a unique URL, identity and label."
    );
  const text = typeof input.prompt === "string" ? input.prompt : "";
  for (const match of text.matchAll(/(^|[^A-Za-z0-9_@])@(Image\d+)(?![A-Za-z0-9_])/g)) {
    if (!references.some((ref) => ref.label === match[2]))
      throw new Error(
        messages?.missing(match[2]!) ??
          `Reference @${match[2]} is missing. Remove its mention or attach the intended image.`
      );
  }
  const matches: { start: number; end: number; ref: (typeof references)[number] }[] = [];
  for (const ref of references) {
    const token = `@${ref.label}`;
    let cursor = 0;
    while (cursor < text.length) {
      const start = text.indexOf(token, cursor);
      if (start < 0) break;
      const end = start + token.length;
      cursor = end;
      // Do not reinterpret @Image1 inside @Image10 or an email address.
      if (
        (start > 0 && /[A-Za-z0-9_@]/.test(text[start - 1]!)) ||
        /[A-Za-z0-9_]/.test(text[end] ?? "")
      )
        continue;
      matches.push({ start, end, ref });
    }
  }
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const nodes: z.infer<typeof promptDocument>["nodes"] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    if (match.start > cursor) nodes.push({ type: "text", text: text.slice(cursor, match.start) });
    nodes.push({ type: "asset_ref", refId: match.ref.refId, label: match.ref.label });
    cursor = match.end;
  }
  if (cursor < text.length) nodes.push({ type: "text", text: text.slice(cursor) });
  if (!nodes.length) nodes.push({ type: "text", text });
  return { referenceBindings: references, promptDocument: { version: 1 as const, nodes } };
}

/** Replacing a URL invalidates the old file identity and measured media facts. */
export function replaceImageUrl(row: ImageReference, url: string): ImageReference {
  const next: ImageReference = { ...row, url };
  delete next.assetId;
  delete next.bytes;
  delete next.durationSeconds;
  return next;
}
