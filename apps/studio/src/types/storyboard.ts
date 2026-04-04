export type ImageStatus = "pending" | "generating" | "done" | "failed";

export interface StoryboardShot {
  id: string;
  shotNumber: number;
  description: string;
  videoPrompt: string;
  shotSize: string;
  cameraMovement: string;
  dialogue: string;
  narration: string;
  duration: number;
  imageUrl?: string;
  videoUrl?: string;
  imageStatus: ImageStatus;
  videoStatus: ImageStatus;
}

export interface StoryboardEpisode {
  id: string;
  title: string;
  shots: StoryboardShot[];
}
