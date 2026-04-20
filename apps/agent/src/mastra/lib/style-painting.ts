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
  return `\n\n项目画风提示：${v}\n（提示词里**不要**直接写画风关键词——下游会统一拼接。但请根据该画风的特征选择恰当的视觉 token，例如写实风强调皮肤/布料质感细节，二次元风强调轮廓/色块，油画风强调笔触/肌理。）`;
}
