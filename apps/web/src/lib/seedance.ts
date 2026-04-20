/**
 * Seedance 2.0 prompt-template helpers shared between draft-detail dialog
 * (HITL review) and character-edit dialog (manual edit). The template is
 * a long "character sheet" trailer appended to the user's base prompt —
 * producing multi-angle reference images when the image model (Seedance
 * 2.0) sees it.
 *
 * Kept as plain exports, not hooks, so both Redux-driven and local-state
 * callers can use the same transformation.
 */

export type SeedanceEntityType = "role" | "scene" | "prop";

/**
 * 8K realism + multi-angle character sheet template. Role-only for now —
 * scene/prop templates would differ (establishing shots, product photography)
 * and we'll add them when product-side asks.
 */
export const SEEDANCE_CHARACTER_TEMPLATE =
  "8K超高清，皮肤肌理细致入微，毛孔极致细节，无动作，极具写实，影棚实拍真人质感。角色设计表，角色多角度转面参考图，补充视角组，正面视图、正侧面视图、背面视图、45度侧视图、俯视顶视图、仰视底视图，头部细节组(正脸、侧脸特写)，材质细节纹理研究组、布料纹理、鞋子的特写镜头，干净的纯白色背景，排版规整，带有文字标注，均匀光照，无阴影,白色背景，去除Ai塑料感，去除Ai味。";

export function getSeedanceTemplate(
  entityType: SeedanceEntityType | string | undefined
): string | null {
  if (entityType === "role") return SEEDANCE_CHARACTER_TEMPLATE;
  return null;
}

/**
 * Append the Seedance template to `currentPrompt`. Idempotent — calling
 * twice won't stack the template (detects the " (template)" suffix that
 * the previous call produced and no-ops).
 */
export function applySeedanceTemplate(
  currentPrompt: string,
  entityType: SeedanceEntityType | string | undefined
): string {
  const template = getSeedanceTemplate(entityType);
  if (!template) return currentPrompt;
  const base = (currentPrompt ?? "").trim();
  const suffix = ` (${template})`;
  // Already appended → no-op (guards against double-click accidental stacking)
  if (base.endsWith(suffix) || base === `(${template})`) return base;
  if (!base) return `(${template})`;
  return `${base} (${template})`;
}
