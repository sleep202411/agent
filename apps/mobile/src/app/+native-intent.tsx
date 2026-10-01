import { redirectGpsSearch } from "@/features/content-gps/search-link";
import { redirectCastingInvite } from "@/features/ai-lab/casting-invite-link";
import { redirectCrewOpening } from "@/features/browse/crew-opening-link";
import Constants from "expo-constants";
import { appEnv } from "@/config/app-env";
import { redirectStudioInvite } from "@/features/agent/studio-invite-link";
import { redirectIpTagLink } from "@/features/browse/ip-tag-link";
import { redirectStudioSearch } from "@/features/studios/studio-search-link";
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  const configured = Constants.expoConfig?.scheme;
  const schemes = typeof configured === "string" ? [configured] : (configured ?? []);
  return redirectGpsSearch(
    redirectStudioSearch(
      redirectIpTagLink(
        redirectStudioInvite(
          redirectCastingInvite(
            redirectCrewOpening(path, appEnv.appRegion, schemes),
            appEnv.appRegion,
            schemes
          ),
          appEnv.appRegion,
          schemes
        ),
        appEnv.appRegion,
        schemes
      ),
      appEnv.appRegion,
      schemes
    ),
    appEnv.appRegion,
    schemes
  );
}
