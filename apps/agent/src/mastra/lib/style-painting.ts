/**
 * Helpers for threading the project's chosen visual style (stylePainting)
 * into designer LLM prompts.
 *
 * The value of ctx.stylePainting may be an id (e.g. "cinematic_realism")
 * or a human-readable label — the upstream context plumbing doesn't
 * normalize. Designers use it as a hint: steer token choices toward
 * style-appropriate vocabulary (realistic vs anime vs oil-painting etc).
 *
 * Downstream image-gen still appends the canonical style tokens, so the
 * designer's prompt itself must NOT include style keywords — this is
 * purely informational.
 */
export function stylePaintingHint(stylePainting: string | undefined): string {
  const v = (stylePainting ?? "").trim();
  if (!v) return "";
  return `\n\nProject art-style hint: ${v}\n(Do **not** write style keywords in the prompt itself — downstream concatenates them uniformly. Instead, pick visual tokens that fit the style: realistic styles emphasize skin / fabric texture; anime styles emphasize silhouette and color blocks; oil-painting styles emphasize brushwork and texture.)`;
}
