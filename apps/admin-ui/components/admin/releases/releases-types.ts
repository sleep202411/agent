export type AppPlatform = "ios" | "android";

export interface AppReleaseRow {
  id: string;
  platform: AppPlatform;
  versionName: string;
  versionCode: number;
  downloadUrl: string;
  releaseNotes: string | null;
  minSupportedCode: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AppReleasesData {
  items: AppReleaseRow[];
}

export const PLATFORM_LABELS: Record<AppPlatform, string> = {
  ios: "iOS",
  android: "Android",
};
