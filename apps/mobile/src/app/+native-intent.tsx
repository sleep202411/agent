import Constants from "expo-constants";
import { appEnv } from "@/config/app-env";
import { redirectStudioInvite } from "@/features/agent/studio-invite-link";
import { redirectIpTagLink } from "@/features/browse/ip-tag-link";
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  const configured = Constants.expoConfig?.scheme;
  const schemes = typeof configured === "string" ? [configured] : (configured ?? []);
  return redirectIpTagLink(
    redirectStudioInvite(path, appEnv.appRegion, schemes),
    appEnv.appRegion,
    schemes
  );
}
