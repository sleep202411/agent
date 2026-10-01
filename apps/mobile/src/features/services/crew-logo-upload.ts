import { Platform } from "react-native";
import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { pickWorkFile } from "@/features/profile/publish-work-api";

/** Uploads the Crew logo only; unlike profile-banner editing this never updates the user. */
export async function pickCrewLogo(generation: number, signal: AbortSignal) {
  const current = () => {
    if (signal.aborted || generation !== getAuthGeneration())
      throw new Error("Crew logo session expired or request cancelled.");
  };
  current();
  const asset = await pickWorkFile("cover");
  current();
  if (!asset) return null;
  const form = new FormData();
  if (Platform.OS === "web") {
    if (!asset.file) throw new Error("Missing browser image file.");
    form.append("file", asset.file, asset.name);
  } else
    form.append("file", {
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType,
    } as unknown as Blob);
  const path = await api.postFormData("/project/uploadBanner", form, {
    service: "content",
    signal,
  });
  current();
  return z.string().trim().min(1).max(512).parse(path);
}
