/**
 * Batch generation for Step 3 storyboard assets:
 * - Shot images (flux-schnell)
 * - Shot videos (Wan I2V from first frame)
 * - Dialogue/Narration TTS (Kokoro)
 * - Episode BGM (Stable Audio)
 */

import { api } from "@/src/lib/api";
import { store } from "@/src/store";
import {
  updateShot,
  setStoryboards,
  type Shot,
  type EpisodeStoryboard,
} from "@/src/store/slices/agentSlice";

// ─── API helpers ─────────────────────────────────────

async function generateImage(prompt: string, imageSize: string = "portrait_16_9"): Promise<string> {
  const result = await api.post<{ url: string }>("/aurora/api/ai-models/generate", {
    data: {
      modelId: "flux-schnell",
      params: { prompt, image_size: imageSize },
    },
  });
  return result.url;
}

async function generateVideo(prompt: string, imageUrl: string): Promise<string> {
  const result = await api.post<{ url: string }>("/aurora/api/ai-models/generate", {
    data: {
      modelId: "wan-i2v",
      params: { prompt, image_url: imageUrl },
    },
  });
  return result.url;
}

async function generateTTS(text: string): Promise<string> {
  const result = await api.post<{ url: string }>("/aurora/api/ai-models/generate", {
    data: {
      modelId: "kokoro-tts",
      params: { text, speed: 1 },
    },
  });
  return result.url;
}

async function generateBGM(prompt: string, duration: number): Promise<string> {
  const result = await api.post<{ url: string }>("/aurora/api/ai-models/generate", {
    data: {
      modelId: "stable-audio",
      params: { prompt, seconds_total: Math.min(duration, 47) },
    },
  });
  return result.url;
}

// ─── Shot prompt builder ─────────────────────────────

function buildShotPrompt(shot: Shot, outline?: { videoStyle?: string }): string {
  const style = outline?.videoStyle ?? "3D, CG动画";
  return `${style}, cinematic shot, ${shot.cameraAngle}, camera ${shot.cameraMovement}, ${shot.description}`;
}

// ─── Batch: Generate all shot images for all episodes ──

export async function batchGenerateShotImages() {
  const { storyboards, outline } = store.getState().agent;

  const tasks: Promise<void>[] = [];

  for (const sb of storyboards) {
    for (const shot of sb.shots) {
      if (shot.imageUrl || shot.imageStatus === "generating") continue;
      tasks.push(
        (async () => {
          store.dispatch(
            updateShot({
              episodeId: sb.episodeId,
              shotId: shot.id,
              updates: { imageStatus: "generating" },
            })
          );
          try {
            const aspectRatio =
              outline?.aspectRatio === "16:9" ? "landscape_16_9" : "portrait_16_9";
            const url = await generateImage(
              buildShotPrompt(shot, outline ?? undefined),
              aspectRatio
            );
            store.dispatch(
              updateShot({
                episodeId: sb.episodeId,
                shotId: shot.id,
                updates: { imageUrl: url, imageStatus: "done" },
              })
            );
          } catch (err) {
            console.warn("[batchGenerateShotImages] Failed:", err);
            store.dispatch(
              updateShot({
                episodeId: sb.episodeId,
                shotId: shot.id,
                updates: { imageStatus: "pending" },
              })
            );
          }
        })()
      );
    }
  }

  await Promise.allSettled(tasks);
  persistStoryboardStep();
}

// ─── Batch: Generate video for all shots (requires images) ──

export async function batchGenerateShotVideos() {
  const { storyboards, outline } = store.getState().agent;

  const tasks: Promise<void>[] = [];

  for (const sb of storyboards) {
    for (const shot of sb.shots) {
      if (!shot.imageUrl || shot.videoUrl || shot.videoStatus === "generating") continue;
      tasks.push(
        (async () => {
          store.dispatch(
            updateShot({
              episodeId: sb.episodeId,
              shotId: shot.id,
              updates: { videoStatus: "generating" },
            })
          );
          try {
            const url = await generateVideo(
              buildShotPrompt(shot, outline ?? undefined),
              shot.imageUrl!
            );
            store.dispatch(
              updateShot({
                episodeId: sb.episodeId,
                shotId: shot.id,
                updates: { videoUrl: url, videoStatus: "done" },
              })
            );
          } catch (err) {
            console.warn("[batchGenerateShotVideos] Failed:", err);
            store.dispatch(
              updateShot({
                episodeId: sb.episodeId,
                shotId: shot.id,
                updates: { videoStatus: "pending" },
              })
            );
          }
        })()
      );
    }
  }

  await Promise.allSettled(tasks);
  persistStoryboardStep();
}

// ─── Batch: Generate TTS for all shots ──────────────

export async function batchGenerateTTS() {
  const { storyboards } = store.getState().agent;

  const tasks: Promise<void>[] = [];

  for (const sb of storyboards) {
    for (const shot of sb.shots) {
      if (shot.audioStatus === "generating") continue;

      const needsDialogue = shot.dialogue && !shot.dialogueAudioUrl;
      const needsNarration = shot.narration && !shot.narrationAudioUrl;

      if (!needsDialogue && !needsNarration) continue;

      tasks.push(
        (async () => {
          store.dispatch(
            updateShot({
              episodeId: sb.episodeId,
              shotId: shot.id,
              updates: { audioStatus: "generating" },
            })
          );
          try {
            const [dialogueUrl, narrationUrl] = await Promise.all([
              needsDialogue ? generateTTS(shot.dialogue) : Promise.resolve(undefined),
              needsNarration ? generateTTS(shot.narration) : Promise.resolve(undefined),
            ]);
            store.dispatch(
              updateShot({
                episodeId: sb.episodeId,
                shotId: shot.id,
                updates: {
                  ...(dialogueUrl && { dialogueAudioUrl: dialogueUrl }),
                  ...(narrationUrl && { narrationAudioUrl: narrationUrl }),
                  audioStatus: "done",
                },
              })
            );
          } catch (err) {
            console.warn("[batchGenerateTTS] Failed:", err);
            store.dispatch(
              updateShot({
                episodeId: sb.episodeId,
                shotId: shot.id,
                updates: { audioStatus: "pending" },
              })
            );
          }
        })()
      );
    }
  }

  await Promise.allSettled(tasks);
  persistStoryboardStep();
}

// ─── Batch: Generate BGM for each episode ────────────

export async function batchGenerateBGM() {
  const { storyboards } = store.getState().agent;

  const tasks: Promise<void>[] = [];

  for (const sb of storyboards) {
    if (sb.bgmUrl || sb.bgmStatus === "generating") continue;

    const totalDuration = sb.shots.reduce((sum, s) => sum + s.duration, 0);

    tasks.push(
      (async () => {
        store.dispatch(
          setStoryboards(
            storyboards.map((s) =>
              s.episodeId === sb.episodeId ? { ...s, bgmStatus: "generating" } : s
            )
          )
        );
        try {
          const prompt = `Background music for: ${sb.title}, cinematic, emotional, no vocals`;
          const url = await generateBGM(prompt, totalDuration);
          const latest = store.getState().agent.storyboards;
          store.dispatch(
            setStoryboards(
              latest.map((s) =>
                s.episodeId === sb.episodeId ? { ...s, bgmUrl: url, bgmStatus: "done" } : s
              )
            )
          );
        } catch (err) {
          console.warn("[batchGenerateBGM] Failed:", err);
          const latest = store.getState().agent.storyboards;
          store.dispatch(
            setStoryboards(
              latest.map((s) => (s.episodeId === sb.episodeId ? { ...s, bgmStatus: "pending" } : s))
            )
          );
        }
      })()
    );
  }

  await Promise.allSettled(tasks);
  persistStoryboardStep();
}

// ─── Generate ALL assets for storyboard ──────────────

export async function generateAllStoryboardAssets() {
  // Phase 1: Images + TTS in parallel
  await Promise.all([batchGenerateShotImages(), batchGenerateTTS()]);

  // Phase 2: Videos (need images first) + BGM in parallel
  await Promise.all([batchGenerateShotVideos(), batchGenerateBGM()]);
}

// ─── Persist step result ─────────────────────────────

function persistStoryboardStep() {
  const { taskId, storyboards } = store.getState().agent;
  if (!taskId) return;

  api
    .put(`/api/tasks/${taskId}/steps/3`, {
      data: {
        stepLabel: "生成分集视频",
        result: { storyboards },
      },
    })
    .catch((err) => console.warn("[persistStoryboardStep] Failed:", err));
}
