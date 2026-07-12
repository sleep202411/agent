import { z } from "zod";

const StableIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/, "Production identifiers must be stable uppercase kebab ids");

const RepoPathSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.startsWith("/") && !value.includes(".."), {
    message: "Reference paths must remain repository-relative",
  });

const RuntimePathSchema = z.string().startsWith("/jinling-rumeng/production/");

export const JinlingProductionReferenceSchema = z
  .object({
    referenceId: StableIdSchema,
    path: RepoPathSchema,
    role: z.string().trim().min(1),
    requiresVirtualPortrait: z.boolean(),
  })
  .strict();

export const JinlingProductionVisualSchema = z
  .object({
    visualId: StableIdSchema,
    sceneId: StableIdSchema,
    path: RuntimePathSchema,
    durationSeconds: z.number().positive(),
    audioEmbedded: z.literal(false),
    status: z.enum(["REVIEW", "APPROVED"]),
  })
  .strict();

export const JinlingAudioTaskSchema = z
  .object({
    taskId: StableIdSchema,
    sceneId: StableIdSchema,
    condition: z.string().trim().min(1),
    dialogueIds: z.array(StableIdSchema).min(1),
    speakerId: StableIdSchema,
    provider: z.literal("seedaudio"),
    task: z.literal("voice"),
    voiceCardId: StableIdSchema,
    text: z.string().trim().min(1),
    performance: z.string().trim().min(1),
    targetDurationSeconds: z.number().min(2).max(12),
    delivery: z
      .object({
        format: z.literal("wav"),
        sampleRateHz: z.literal(48000),
        bitDepth: z.literal(24),
        channels: z.literal(1),
      })
      .strict(),
    outputPath: RuntimePathSchema,
  })
  .strict();

export const JinlingVideoTaskSchema = z
  .object({
    taskId: StableIdSchema,
    assetId: StableIdSchema,
    sceneId: StableIdSchema,
    condition: z.string().trim().min(1),
    dialogueIds: z.array(StableIdSchema),
    provider: z.literal("seedance-2.0"),
    endpointId: z.string().trim().min(1),
    mode: z.enum(["image-to-video", "first-last-frame-to-video", "multimodal-to-video"]),
    generateAudio: z.boolean(),
    durationSeconds: z.number().int().min(4).max(15),
    resolution: z.literal("1080p"),
    width: z.literal(1920),
    height: z.literal(1080),
    framesPerSecond: z.literal(24),
    frameCount: z.number().int().positive(),
    prompt: z.string().trim().min(1),
    timeline: z.string().trim().min(1),
    negative: z.array(z.string().trim().min(1)).min(1),
    referenceIds: z.array(StableIdSchema).min(1),
    outputPath: RuntimePathSchema,
    recordPath: z.string().startsWith("production/records/"),
  })
  .strict()
  .superRefine((task, context) => {
    if (task.frameCount !== task.durationSeconds * task.framesPerSecond) {
      context.addIssue({
        code: "custom",
        path: ["frameCount"],
        message: "Frame count must exactly match the 24fps duration",
      });
    }
    if (task.mode === "image-to-video" && task.referenceIds.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["referenceIds"],
        message: "Image-to-video requires exactly one first-frame reference",
      });
    }
    if (task.mode === "first-last-frame-to-video" && task.referenceIds.length !== 2) {
      context.addIssue({
        code: "custom",
        path: ["referenceIds"],
        message: "First-last-frame video requires exactly two ordered frame references",
      });
    }
  });

const AssemblyCueSchema = z
  .object({
    cueId: StableIdSchema,
    kind: z.enum(["visual", "video-task", "audio-task", "interaction"]),
    refId: StableIdSchema,
    trigger: z.enum(["node-enter", "visual-time", "profile-ready", "profile-confirmed"]),
    startSeconds: z.number().nonnegative().optional(),
  })
  .strict()
  .superRefine((cue, context) => {
    if (cue.trigger === "visual-time" && cue.startSeconds === undefined) {
      context.addIssue({
        code: "custom",
        path: ["startSeconds"],
        message: "Visual-time cues require an authored start time",
      });
    }
    if (cue.trigger !== "visual-time" && cue.startSeconds !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["startSeconds"],
        message: "Only visual-time cues may carry a start time",
      });
    }
  });

export const JinlingAssemblyNodeSchema = z
  .object({
    nodeId: StableIdSchema,
    sceneId: StableIdSchema,
    condition: z.string().trim().min(1),
    cues: z.array(AssemblyCueSchema).min(1),
  })
  .strict();

export const JinlingShotProductionPackSchema = z
  .object({
    schemaVersion: z.literal(1),
    productionVersion: z.literal("1.0.0"),
    dialogueLockVersion: z.literal("1.0.0"),
    dialogueManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.literal("LOCKED"),
    title: z.literal("金陵入梦：无字来客"),
    scopeSceneIds: z.array(StableIdSchema).min(1),
    orientation: z.literal("landscape-only"),
    aspectRatio: z.literal("16:9"),
    playerVoice: z.literal("silent-choice-intent"),
    references: z.array(JinlingProductionReferenceSchema).min(1),
    existingVisuals: z.array(JinlingProductionVisualSchema).min(1),
    audioTasks: z.array(JinlingAudioTaskSchema).min(1),
    videoTasks: z.array(JinlingVideoTaskSchema).min(1),
    assemblyNodes: z.array(JinlingAssemblyNodeSchema).min(1),
  })
  .strict()
  .superRefine((pack, context) => {
    const unique = (values: string[], path: string) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          path: [path],
          message: `${path} identifiers must be unique`,
        });
      }
    };

    unique(
      pack.references.map((item) => item.referenceId),
      "references"
    );
    unique(
      pack.existingVisuals.map((item) => item.visualId),
      "existingVisuals"
    );
    unique(
      pack.audioTasks.map((item) => item.taskId),
      "audioTasks"
    );
    unique(
      pack.videoTasks.map((item) => item.taskId),
      "videoTasks"
    );
    unique(
      pack.videoTasks.map((item) => item.assetId),
      "videoTasks"
    );
    unique(
      pack.assemblyNodes.map((item) => item.nodeId),
      "assemblyNodes"
    );

    const referenceIds = new Set(pack.references.map((item) => item.referenceId));
    pack.videoTasks.forEach((task, taskIndex) => {
      task.referenceIds.forEach((referenceId, referenceIndex) => {
        if (!referenceIds.has(referenceId)) {
          context.addIssue({
            code: "custom",
            path: ["videoTasks", taskIndex, "referenceIds", referenceIndex],
            message: `Unknown production reference ${referenceId}`,
          });
        }
      });
    });

    const cueTargets = new Map<string, "visual" | "video-task" | "audio-task" | "interaction">();
    pack.existingVisuals.forEach((item) => cueTargets.set(item.visualId, "visual"));
    pack.videoTasks.forEach((item) => cueTargets.set(item.taskId, "video-task"));
    pack.audioTasks.forEach((item) => cueTargets.set(item.taskId, "audio-task"));
    cueTargets.set("P00-PROFILE-INTERACTION", "interaction");

    pack.assemblyNodes.forEach((node, nodeIndex) => {
      node.cues.forEach((cue, cueIndex) => {
        if (cueTargets.get(cue.refId) !== cue.kind) {
          context.addIssue({
            code: "custom",
            path: ["assemblyNodes", nodeIndex, "cues", cueIndex, "refId"],
            message: `Cue target ${cue.refId} does not resolve as ${cue.kind}`,
          });
        }
      });
    });
  });

export type JinlingShotProductionPack = z.infer<typeof JinlingShotProductionPackSchema>;

export function parseJinlingShotProductionPack(value: unknown): JinlingShotProductionPack {
  return JinlingShotProductionPackSchema.parse(value);
}
