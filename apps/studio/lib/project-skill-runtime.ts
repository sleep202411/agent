import {
  promptMentionParts,
  promptMentionToken,
  type PromptMentionItem,
} from "@/lib/prompt-document";
import type {
  ProjectSkillVersionSummary,
  ProjectSkillOwnerKind,
  ProjectSkillInstallation,
  ProjectSkillInstallationsResponse,
  ProjectSkillScope,
  ProjectSkillSelection,
} from "@/lib/project-skills-api";
import type { GenerationModality } from "@/lib/canvas-authoring/generation-node-types";

type ProjectGenerationSkillScope = Extract<
  ProjectSkillScope,
  "image_generation" | "video_generation"
>;

/** Per-card overrides. Project defaults remain authoritative project state. */
export interface CanvasProjectSkillSelection extends ProjectSkillSelection {
  /** Caret offsets in the plain prompt, keyed by project installation id. */
  anchors?: Record<string, number>;
}

interface ProjectSkillMention extends PromptMentionItem {
  kind: "skill";
  id: string;
}

interface EffectiveProjectSkill {
  installation: ProjectSkillInstallation;
  mention: ProjectSkillMention;
  source: "project_default" | "turn_selection";
  anchor: number;
}

export function generationSkillScope(
  modality: GenerationModality
): ProjectGenerationSkillScope | undefined {
  if (modality === "image") return "image_generation";
  if (modality === "video") return "video_generation";
  return undefined;
}

export function projectSkillVersionSupports(
  version: ProjectSkillVersionSummary | null | undefined,
  scope: ProjectGenerationSkillScope | undefined,
  ownerKind: ProjectSkillOwnerKind,
  workbenchMode?: string
): boolean {
  return Boolean(
    version &&
    scope &&
    version.capabilities.includes(scope) &&
    (version.projectKinds.length === 0 || version.projectKinds.includes(ownerKind)) &&
    (version.workbenchModes.length === 0 ||
      Boolean(workbenchMode && version.workbenchModes.includes(workbenchMode)))
  );
}

export function compatibleProjectSkillInstallations(
  projectSkills: ProjectSkillInstallationsResponse | undefined,
  scope: ProjectGenerationSkillScope | undefined,
  workbenchMode?: string
): ProjectSkillInstallation[] {
  if (!projectSkills) return [];
  return projectSkills.installations.filter(
    (installation) =>
      installation.status === "active" &&
      projectSkillVersionSupports(
        installation.version,
        scope,
        projectSkills.ownerKind,
        workbenchMode
      )
  );
}

export function isProjectSkillDefault(input: {
  installation: ProjectSkillInstallation;
  scope: ProjectGenerationSkillScope | undefined;
  sourceSurface: string;
  workbenchMode?: string;
}): boolean {
  if (!input.scope) return false;
  return input.installation.defaults.some(
    (activation) =>
      activation.scope === input.scope &&
      (!activation.sourceSurface || activation.sourceSurface === input.sourceSurface) &&
      (!activation.workbenchMode || activation.workbenchMode === input.workbenchMode)
  );
}

export function projectSkillMention(
  installation: ProjectSkillInstallation,
  label: string
): ProjectSkillMention {
  return {
    id: installation.id,
    label,
    name: label,
    kind: "skill",
    previewUrl: installation.previewUrl ?? undefined,
    previewVideoUrl: installation.previewVideoUrl ?? undefined,
  };
}

export function resolveEffectiveProjectSkills(input: {
  projectSkills: ProjectSkillInstallationsResponse | undefined;
  scope: ProjectGenerationSkillScope | undefined;
  sourceSurface: string;
  workbenchMode?: string;
  selection?: CanvasProjectSkillSelection;
  labelFor: (installation: ProjectSkillInstallation) => string;
  promptLength: number;
}): EffectiveProjectSkill[] {
  if (!input.scope) return [];
  const compatible = compatibleProjectSkillInstallations(
    input.projectSkills,
    input.scope,
    input.workbenchMode
  );
  const byId = new Map(compatible.map((installation) => [installation.id, installation]));
  const included = new Set(
    (input.selection?.includeInstallationIds ?? []).filter((id) => byId.has(id))
  );
  const excluded = new Set(
    (input.selection?.excludeInstallationIds ?? []).filter((id) => byId.has(id))
  );

  return compatible.flatMap((installation) => {
    const defaultEnabled =
      isProjectSkillDefault({
        installation,
        scope: input.scope,
        sourceSurface: input.sourceSurface,
        workbenchMode: input.workbenchMode,
      }) && !excluded.has(installation.id);
    const source = defaultEnabled
      ? ("project_default" as const)
      : included.has(installation.id)
        ? ("turn_selection" as const)
        : null;
    if (!source) return [];
    return [
      {
        installation,
        mention: projectSkillMention(installation, input.labelFor(installation)),
        source,
        anchor: clampAnchor(input.selection?.anchors?.[installation.id], input.promptLength),
      },
    ];
  });
}

/** Render active Skill entities into the editable prompt without persisting labels as prompt text. */
export function composePromptWithProjectSkills(
  prompt: string,
  skills: readonly EffectiveProjectSkill[]
): string {
  const placements = skills
    .map((skill, index) => ({
      anchor: clampAnchor(skill.anchor, prompt.length),
      index,
      token: promptMentionToken(skill.mention),
    }))
    .sort((a, b) => b.anchor - a.anchor || b.index - a.index);
  return placements.reduce(
    (value, placement) => insertMentionAt(value, placement.token, placement.anchor),
    prompt
  );
}

/**
 * Convert the editor's inline Skill entities back into the canonical plain
 * prompt plus explicit per-card overrides. Labels never become instructions;
 * the server resolves installation ids to immutable published versions.
 */
export function extractProjectSkillSelection(input: {
  value: string;
  mentions: readonly ProjectSkillMention[];
  defaultInstallationIds: ReadonlySet<string>;
}): { prompt: string; selection: CanvasProjectSkillSelection } {
  const parts = promptMentionParts(input.value, input.mentions).filter(
    (part) => part.mention?.kind === "skill"
  );
  const present = new Set<string>();
  const anchors: Record<string, number> = {};
  let prompt = input.value;
  let removedBefore = 0;

  for (const part of parts) {
    const mention = part.mention;
    if (!mention) continue;
    const range = {
      start: part.start - removedBefore,
      end: part.end - removedBefore,
    };
    if (!present.has(mention.id)) anchors[mention.id] = range.start;
    present.add(mention.id);
    const next = removeMentionSpan(prompt, range);
    removedBefore += prompt.length - next.value.length;
    prompt = next.value;
  }

  const includeInstallationIds = [...present].filter((id) => !input.defaultInstallationIds.has(id));
  const excludeInstallationIds = [...input.defaultInstallationIds].filter((id) => !present.has(id));
  for (const [id, anchor] of Object.entries(anchors)) {
    anchors[id] = clampAnchor(anchor, prompt.length);
  }

  return {
    prompt,
    selection: compactSelection({ includeInstallationIds, excludeInstallationIds, anchors }),
  };
}

export function sanitizeProjectSkillSelection(
  selection: CanvasProjectSkillSelection | undefined,
  compatibleInstallations: readonly ProjectSkillInstallation[]
): CanvasProjectSkillSelection | undefined {
  if (!selection) return undefined;
  const installed = new Set(compatibleInstallations.map((item) => item.id));
  return compactSelection({
    includeInstallationIds: (selection.includeInstallationIds ?? []).filter((id) =>
      installed.has(id)
    ),
    excludeInstallationIds: (selection.excludeInstallationIds ?? []).filter((id) =>
      installed.has(id)
    ),
    anchors: Object.fromEntries(
      Object.entries(selection.anchors ?? {}).filter(([id]) => installed.has(id))
    ),
  });
}

function compactSelection(selection: CanvasProjectSkillSelection): CanvasProjectSkillSelection {
  const includeInstallationIds = unique(selection.includeInstallationIds ?? []);
  const excludeInstallationIds = unique(selection.excludeInstallationIds ?? []);
  const anchors = selection.anchors ?? {};
  return {
    ...(includeInstallationIds.length > 0 ? { includeInstallationIds } : {}),
    ...(excludeInstallationIds.length > 0 ? { excludeInstallationIds } : {}),
    ...(Object.keys(anchors).length > 0 ? { anchors } : {}),
  };
}

function insertMentionAt(value: string, token: string, anchor: number): string {
  if (value.includes(token)) return value;
  const offset = clampAnchor(anchor, value.length);
  const before = value.slice(0, offset).replace(/[ \t]+$/, "");
  const after = value.slice(offset).replace(/^[ \t]+/, "");
  return `${before}${before ? " " : ""}${token}${after ? " " : ""}${after}`;
}

function removeMentionSpan(
  value: string,
  range: { start: number; end: number }
): { value: string } {
  let { start, end } = range;
  if (value[end] === " ") end += 1;
  else if (start > 0 && value[start - 1] === " ") start -= 1;
  return { value: `${value.slice(0, start)}${value.slice(end)}` };
}

function clampAnchor(anchor: number | undefined, promptLength: number): number {
  if (typeof anchor !== "number" || !Number.isFinite(anchor)) return promptLength;
  return Math.max(0, Math.min(Math.trunc(anchor), promptLength));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
