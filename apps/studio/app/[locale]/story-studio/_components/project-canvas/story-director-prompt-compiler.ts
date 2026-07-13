import type { StoryClipPromptDraft, StoryTrailerPromptDraft } from "@/lib/story-projects-api";

type StoryDirectorPromptDraft = StoryClipPromptDraft | StoryTrailerPromptDraft;

const BEAT_FIELDS = [
  ["Visual", "visual"],
  ["Camera", "camera"],
  ["Action", "action"],
  ["Performance", "performance"],
  ["Emotion", "emotion"],
  ["Dialogue", "dialogue"],
  ["Audio", "audio"],
  ["End state", "endState"],
  ["Continuity", "continuity"],
] as const;

/**
 * Deterministically compiles mutable director authoring into a provider-neutral
 * manifest. The production adapter remains responsible for compacting this
 * manifest into Seedance's provider prompt budget, reference binding, output
 * contracts, and take submission.
 */
export function compileDirectorPromptManifest(prompt: StoryDirectorPromptDraft): string {
  const identity = "clipKey" in prompt ? prompt.clipKey : "TRAILER";
  const sections: string[] = [
    `# ${prompt.title.trim() || identity}`,
    [
      `${"clipKey" in prompt ? "Clip" : "Trailer"}: ${identity}`,
      `Duration: ${formatSeconds(prompt.targetDurationMs)}`,
      `Generation: ${generationControlLabel(prompt)}`,
    ].join(" | "),
  ];

  pushSection(sections, "DESCRIPTION", prompt.description);
  pushSection(sections, "MASTER DIRECTION", prompt.masterDirection);

  if (prompt.referenceRoleNotes.length > 0) {
    sections.push(
      "REFERENCE ROLES",
      ...prompt.referenceRoleNotes.map((reference) => {
        const identity = reference.referenceId.trim() || "unassigned";
        const note = reference.note.trim();
        return `- [${reference.role}] ${identity}${note ? ` — ${note}` : ""}`;
      })
    );
  }

  pushSection(sections, "EMOTIONAL ARC", prompt.emotionalArc);

  sections.push(
    "TIMELINE",
    ...(prompt.beats.length > 0
      ? prompt.beats.flatMap((beat, index) => {
          const lines = [
            `[${formatSeconds(beat.startMs)}–${formatSeconds(beat.endMs)}] Beat ${index + 1}`,
          ];
          for (const [label, key] of BEAT_FIELDS) {
            const value = beat[key].trim();
            if (value) lines.push(`${label}: ${value}`);
          }
          return lines;
        })
      : ["No time-coded beats authored."])
  );

  if (prompt.negativeConstraints.length > 0) {
    sections.push(
      "NEGATIVE CONSTRAINTS",
      ...prompt.negativeConstraints
        .map((constraint) => constraint.trim())
        .filter(Boolean)
        .map((constraint) => `- ${constraint}`)
    );
  }

  if (prompt.continuityNotes.length > 0) {
    sections.push(
      "CONTINUITY NOTES",
      ...prompt.continuityNotes
        .map((note) => note.trim())
        .filter(Boolean)
        .map((note) => `- ${note}`)
    );
  }

  return sections.join("\n\n");
}

function pushSection(sections: string[], heading: string, value: string): void {
  const normalized = value.trim();
  if (normalized) sections.push(heading, normalized);
}

function generationControlLabel(prompt: StoryDirectorPromptDraft): string {
  if (prompt.generationControl.mode === "omni_reference") return "Omni Reference";
  return prompt.generationControl.frameMode === "first_last_frame"
    ? "First + Last Frame"
    : "First Frame";
}

function formatSeconds(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(1)}s`;
}
