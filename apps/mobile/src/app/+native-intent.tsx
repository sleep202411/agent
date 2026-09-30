import Constants from "expo-constants";
import { appEnv } from "@/config/app-env";
import { redirectStudioInvite } from "@/features/agent/studio-invite-link";
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  const configured = Constants.expoConfig?.scheme;
  const schemes = typeof configured === "string" ? [configured] : (configured ?? []);
  return redirectStudioInvite(path, appEnv.appRegion, schemes);
}
