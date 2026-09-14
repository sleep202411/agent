import type { ModelSettings } from "./generation-api";

/**
 * Omni-reference task types surfaced as first-class mode-menu entries.
 *
 * Seedance 2.5's edit/extend intents only exist inside the omni-reference
 * mode (`omni_reference_task_type`), so instead of a second sub-mode
 * selector they are listed directly under the mode menu. The composite
 * values (`multimodal_to_video::edit`) are UI-only: selecting one maps back
 * to `mode = multimodal_to_video` + `settings.omniReferenceTaskType`, so the
 * node data, submit path, catalog x-rules and wire contract stay untouched.
 */
const OMNI_REFERENCE_MODE = "multimodal_to_video";

/** Schema field that carries the selected task type. */
export const OMNI_TASK_TYPE_FIELD = "omniReferenceTaskType";

/** Task types that get their own mode-menu entry. `reference` is the
 *  constraint-free twin of `auto` and stays API/agent-only — a menu entry
 *  would read as a duplicate of Omni Reference. */
const MENU_TASK_TYPES = ["edit", "extend"] as const;

function composeOmniTaskModeValue(taskType: string): string {
  return `${OMNI_REFERENCE_MODE}::${taskType}`;
}

export function isOmniTaskModeValue(value: string): boolean {
  return value.startsWith(`${OMNI_REFERENCE_MODE}::`);
}

export function splitOmniTaskModeValue(value: string): {
  mode: string;
  taskType: string;
} {
  const separator = value.indexOf("::");
  return {
    mode: value.slice(0, separator),
    taskType: value.slice(separator + 2),
  };
}

/** Mode list extended with the omni sub-intent entries, inserted right after
 *  the omni-reference mode they belong to. Models whose schema does not
 *  declare task types get the list back unchanged. */
export function modeMenuValues(
  modes: readonly string[],
  taskTypes: readonly string[] | null
): string[] {
  if (!taskTypes) return [...modes];
  const out: string[] = [];
  for (const value of modes) {
    out.push(value);
    if (value === OMNI_REFERENCE_MODE) {
      for (const taskType of MENU_TASK_TYPES) {
        if (taskTypes.includes(taskType)) {
          out.push(composeOmniTaskModeValue(taskType));
        }
      }
    }
  }
  return out;
}

/** The menu value that represents the current selection: omni sub-intents
 *  resolve to their composite entry, everything else to the mode itself. */
export function menuValueForMode(
  mode: string | undefined,
  taskType: string | undefined
): string | undefined {
  if (mode === OMNI_REFERENCE_MODE && (taskType === "edit" || taskType === "extend")) {
    return composeOmniTaskModeValue(taskType);
  }
  return mode;
}

/** Setting fields the active task type takes over from the user (ModelArk
 *  doc 1520757: editing keeps the source video's ratio AND duration;
 *  extension keeps its ratio — duration stays user-settable [4,30]). Their
 *  controls hide while locked; selectMode forces the value to auto. */
export function lockedSettingFields(taskType: string | undefined): ReadonlySet<string> {
  if (taskType === "edit") return new Set(["aspectRatio", "duration"]);
  if (taskType === "extend") return new Set(["aspectRatio"]);
  return new Set<string>();
}

/**
 * Mode-menu selection, including the UI-only omni sub-intent entries.
 * `multimodal_to_video::edit` maps to mode + task type and forces the
 * ModelArk-locked knobs to auto. Any non-composite selection (including
 * plain Omni Reference) resets the task type to auto.
 */
export function applyOmniModeSelection(
  menuValue: string,
  settings: ModelSettings
): { mode: string; settings: ModelSettings } {
  const parsed = isOmniTaskModeValue(menuValue) ? splitOmniTaskModeValue(menuValue) : null;
  const taskType = parsed?.taskType ?? "auto";
  const mode = parsed?.mode ?? menuValue;
  const next: ModelSettings = { ...settings, [OMNI_TASK_TYPE_FIELD]: taskType };
  if (taskType === "edit" || taskType === "extend") {
    next.aspectRatio = "auto";
    if (taskType === "edit") next.duration = "auto";
  }
  return { mode, settings: next };
}
