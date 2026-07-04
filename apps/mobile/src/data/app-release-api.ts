/**
 * App version manifest — Nest `GET /aurora/app-releases/latest?platform=…`
 * (@Public). Region is implicit: each build only talks to its region's
 * aurora host, so the CN app sees the CN release line.
 */
import { Platform } from "react-native";

import { api } from "@/lib/api-client";

export interface AppRelease {
  versionName: string;
  versionCode: number;
  downloadUrl: string;
  releaseNotes?: string;
  /** Builds older than this code should be force-prompted. */
  minSupportedCode?: number;
}

type ReleaseDto = {
  versionName?: string;
  versionCode?: number;
  downloadUrl?: string;
  releaseNotes?: string | null;
  minSupportedCode?: number | null;
};

export async function fetchLatestRelease(): Promise<AppRelease | null> {
  const data = await api.get<{ release?: ReleaseDto | null }>("/app-releases/latest", {
    service: "aurora",
    params: { platform: Platform.OS === "ios" ? "ios" : "android" },
  });
  const raw = data?.release;
  if (!raw || typeof raw.versionCode !== "number" || !raw.versionName || !raw.downloadUrl) {
    return null;
  }
  return {
    versionName: raw.versionName,
    versionCode: raw.versionCode,
    downloadUrl: raw.downloadUrl,
    releaseNotes: raw.releaseNotes ?? undefined,
    minSupportedCode: raw.minSupportedCode ?? undefined,
  };
}
