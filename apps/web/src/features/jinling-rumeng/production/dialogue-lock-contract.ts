import { z } from "zod";

const StableIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/, "Dialogue identifiers must be stable uppercase kebab ids");

export const JinlingDialogueSpeakerSchema = z
  .object({
    speakerId: StableIdSchema,
    displayName: z.string().trim().min(1),
    voiceDirection: z.string().trim().min(1),
  })
  .strict();

export const JinlingDialogueLineSchema = z
  .object({
    dialogueId: StableIdSchema,
    sceneId: StableIdSchema,
    shotId: StableIdSchema,
    speakerId: StableIdSchema,
    text: z.string().trim().min(1),
    condition: z.string().trim().min(1),
    performance: z.string().trim().min(1),
    targetDurationSeconds: z.number().min(2).max(12),
    audioStrategy: z.enum(["seedaudio-vo", "seedance-sync"]),
    aspectRatio: z.literal("16:9"),
    subtitle: z.literal(true),
  })
  .strict();

export const JinlingDialogueChoiceSchema = z
  .object({
    choiceId: StableIdSchema,
    sceneId: StableIdSchema,
    text: z.string().trim().min(1),
    spoken: z.literal(false),
    reactionDialogueIds: z.array(StableIdSchema).min(1),
  })
  .strict();

export const JinlingDialogueLockSchema = z
  .object({
    schemaVersion: z.literal(1),
    lockVersion: z.literal("1.0.0"),
    status: z.literal("LOCKED"),
    language: z.literal("zh-CN"),
    title: z.literal("金陵入梦：无字来客"),
    playerVoice: z.literal("silent-choice-intent"),
    orientation: z.literal("landscape-only"),
    aspectRatio: z.literal("16:9"),
    speakers: z.array(JinlingDialogueSpeakerSchema).min(1),
    lines: z.array(JinlingDialogueLineSchema).min(1),
    choices: z.array(JinlingDialogueChoiceSchema).min(1),
  })
  .strict()
  .superRefine((lock, context) => {
    const speakerIds = new Set(lock.speakers.map((speaker) => speaker.speakerId));
    const dialogueIds = new Set<string>();
    const shotIds = new Set<string>();
    lock.lines.forEach((line, index) => {
      if (!speakerIds.has(line.speakerId)) {
        context.addIssue({
          code: "custom",
          path: ["lines", index, "speakerId"],
          message: `Unknown speaker ${line.speakerId}`,
        });
      }
      if (dialogueIds.has(line.dialogueId)) {
        context.addIssue({
          code: "custom",
          path: ["lines", index, "dialogueId"],
          message: `Duplicate dialogue id ${line.dialogueId}`,
        });
      }
      dialogueIds.add(line.dialogueId);
      if (shotIds.has(line.shotId)) {
        context.addIssue({
          code: "custom",
          path: ["lines", index, "shotId"],
          message: `Duplicate shot id ${line.shotId}`,
        });
      }
      shotIds.add(line.shotId);
    });

    const choiceIds = new Set<string>();
    lock.choices.forEach((choice, index) => {
      if (choiceIds.has(choice.choiceId)) {
        context.addIssue({
          code: "custom",
          path: ["choices", index, "choiceId"],
          message: `Duplicate choice id ${choice.choiceId}`,
        });
      }
      choiceIds.add(choice.choiceId);
      choice.reactionDialogueIds.forEach((dialogueId, reactionIndex) => {
        if (!dialogueIds.has(dialogueId)) {
          context.addIssue({
            code: "custom",
            path: ["choices", index, "reactionDialogueIds", reactionIndex],
            message: `Unknown reaction dialogue ${dialogueId}`,
          });
        }
      });
    });
  });

export type JinlingDialogueLock = z.infer<typeof JinlingDialogueLockSchema>;

export function parseJinlingDialogueLock(value: unknown): JinlingDialogueLock {
  return JinlingDialogueLockSchema.parse(value);
}
