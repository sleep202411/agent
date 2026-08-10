import type { useTranslations } from "next-intl";
import type { StudioModality } from "@/lib/canvas-authoring/use-ai-catalog";

/**
 * Starter-workflow presets. Each drops a pre-wired, generation-ready node graph
 * onto an empty canvas — and the generation nodes open already showing a REAL
 * pre-generated sample (see {@link PresetNode.sample}), so the user sees a
 * finished product, not an empty node. The samples in `public/presets/` were
 * produced by our own pipeline (seedream-4.5 via BytePlus) and are bundled as
 * static assets — representative output, not a fabricated mock.
 *
 * Models are NOT hardcoded — `modelHint` is a preference list resolved against
 * the LIVE catalog at apply-time, falling back to the modality's first usable
 * model (see use-apply-preset). `localId` wires preset edges and is swapped for
 * a fresh uuid on apply.
 */
export interface PresetSample {
  type: "image" | "video";
  /** Bundled asset path under `public/` (served from the studio origin). */
  url: string;
  width: number;
  height: number;
}

export interface PresetNode {
  /** Stable key WITHIN the preset (used to declare edges); not the runtime id. */
  localId: string;
  type: "prompt" | "video" | "note" | "image";
  /** Absolute layout position (source-left / target-right). */
  position: { x: number; y: number };
  /** Generation nodes: catalog modality to resolve a model for. */
  modality?: StudioModality;
  /** Generation nodes: preferred catalog model ids, tried in order (usable wins). */
  modelHint?: string[];
  /** Generation nodes: preferred mode; validated against the resolved model. */
  mode?: string;
  /** Merged over `defaultSettingsForModel` (e.g. force a 16:9 sample aspect). */
  settingsOverride?: Record<string, unknown>;
  /** Pre-generated finished product shown on the node when the preset is applied. */
  sample?: PresetSample;
  /** Static template fields written into node.data (prompt, name, text…). */
  data: Record<string, unknown>;
}

export interface PresetEdge {
  fromLocalId: string;
  toLocalId: string;
}

export interface WorkflowPreset {
  id: string;
  name: string;
  description: string;
  /** Real bundled sample shown on the picker card (NOT a fabricated mock). */
  thumbnail: string;
  nodes: PresetNode[];
  edges: PresetEdge[];
}

const SAMPLE_W = 1600;
const SAMPLE_H = 900;
type CanvasControlsT = ReturnType<typeof useTranslations<"canvasControls">>;

/**
 * A pre-authored storyboard-image → reference-driven-video pipeline. The image
 * node opens showing a real generated storyboard sheet; the video node is wired
 * to it and prompt-ready (the R4 completion back-fill binds the reference once
 * the image is regenerated with a real upstream URL).
 */
function imageToVideo(args: {
  id: string;
  name: string;
  description: string;
  imageName: string;
  imagePrompt: string;
  videoName: string;
  videoPrompt: string;
}): WorkflowPreset {
  const sampleUrl = `/presets/${args.id}.jpg`;
  return {
    id: args.id,
    name: args.name,
    description: args.description,
    thumbnail: sampleUrl,
    nodes: [
      {
        localId: "image",
        type: "prompt",
        modality: "image",
        modelHint: ["seedream-4.5", "gpt-image-2"],
        mode: "text_to_image",
        settingsOverride: { imageSize: "16:9" },
        sample: { type: "image", url: sampleUrl, width: SAMPLE_W, height: SAMPLE_H },
        position: { x: 0, y: 0 },
        data: { name: args.imageName, prompt: args.imagePrompt },
      },
      {
        localId: "video",
        type: "video",
        modality: "video",
        modelHint: ["seedance-2-5", "seedance-2-0", "seedance-2-0-fast"],
        mode: "image_to_video",
        position: { x: 560, y: 0 },
        data: { name: args.videoName, prompt: args.videoPrompt },
      },
    ],
    edges: [{ fromLocalId: "image", toLocalId: "video" }],
  };
}

export function createWorkflowPresets(t: CanvasControlsT): WorkflowPreset[] {
  return [
    imageToVideo({
      id: "marketing-ad",
      name: t("workflowPresets.marketingAd.name"),
      description: t("workflowPresets.marketingAd.description"),
      imageName: t("workflowPresets.nodes.storyboard"),
      imagePrompt:
        "A polished 10-panel storyboard sheet for a cinematic sunglasses commercial — dark editorial layout, numbered frames in a clean grid, each frame a distinct shot with a short title and CAMERA / LIGHTING / PACING notes. Tone: cinematic, luxurious, aspirational.\n" +
        "1. Overhead close-up of the sunglasses on a sunlit beach towel, slow push-in.\n" +
        "2. A woman lifts and puts them on with a confident smile, warm side light.\n" +
        "3. Wide tracking shot of her walking the beach, hair in the breeze, backlit sun flare.\n" +
        "4. Macro of the lens and logo as she adjusts them, soft side light.\n" +
        "5. Friends laughing during beach volleyball, bright and vibrant, quick cuts.\n" +
        "6. Low-angle slow-motion dive for the ball, golden-hour glow.\n" +
        "7. A man gazing at the horizon, the beach reflected in his lenses.\n" +
        "8. High-angle of the group lounging with drinks, clear blue sky, smooth pan.\n" +
        "9. The sunglasses passed hand to hand, playful natural light.\n" +
        "10. Final overhead on the beach towel at sunset, slow fade.",
      videoName: t("workflowPresets.nodes.ad"),
      videoPrompt:
        "A high-end sunglasses commercial in cinematic style, showcasing luxury and aspiration across the storyboard's frames — premium product hero shots, golden-hour light, elegant slow motion and gentle camera moves.",
    }),
    imageToVideo({
      id: "fashion-trailer",
      name: t("workflowPresets.fashionTrailer.name"),
      description: t("workflowPresets.fashionTrailer.description"),
      imageName: t("workflowPresets.nodes.storyboard"),
      imagePrompt:
        "A moody 9-panel storyboard sheet for a high-fashion trailer — sculptural lighting, dramatic shadows, editorial styling, cinematic color grade. Numbered frames in a clean grid with short titles and CAMERA / LIGHTING / PACING notes covering the model entrance, a sweeping runway walk, close detail of flowing fabric, a striking profile in hard light, a slow turn, a couture full-length hero shot, accessories, a dramatic backlit pose, and a final bold hero frame.",
      videoName: t("workflowPresets.nodes.trailer"),
      videoPrompt:
        "A moody high-fashion trailer — a striking model, elegant slow motion, dramatic contrast and sweeping camera moves, editorial color grade.",
    }),
    imageToVideo({
      id: "youtube-vlog",
      name: t("workflowPresets.youtubeVlog.name"),
      description: t("workflowPresets.youtubeVlog.description"),
      imageName: t("workflowPresets.nodes.storyboard"),
      imagePrompt:
        "A bright, energetic 8-panel storyboard sheet for a YouTube vlog intro — candid handheld framing, natural daylight, lively everyday moments. Numbered frames in a clean grid with short titles and CAMERA / LIGHTING / PACING notes covering the upbeat opener, a city b-roll, a cafe moment, a piece-to-camera close-up, a hobby shot, friends laughing, a scenic establishing shot, and an upbeat sign-off frame.",
      videoName: t("workflowPresets.nodes.clip"),
      videoPrompt:
        "An upbeat handheld vlog clip — lively candid motion, bright natural light, friendly energetic pacing.",
    }),
    {
      id: "brand-visuals",
      name: t("workflowPresets.brandVisuals.name"),
      description: t("workflowPresets.brandVisuals.description"),
      thumbnail: "/presets/brand-visuals.jpg",
      nodes: [
        {
          localId: "image",
          type: "prompt",
          modality: "image",
          modelHint: ["seedream-4.5", "gpt-image-2"],
          mode: "text_to_image",
          settingsOverride: { imageSize: "16:9" },
          sample: {
            type: "image",
            url: "/presets/brand-visuals.jpg",
            width: SAMPLE_W,
            height: SAMPLE_H,
          },
          position: { x: 0, y: 0 },
          data: {
            name: t("workflowPresets.nodes.keyVisual"),
            prompt:
              "A clean, on-brand marketing key visual — confident composition, consistent palette, premium product styling, studio lighting.",
          },
        },
      ],
      edges: [],
    },
  ];
}
