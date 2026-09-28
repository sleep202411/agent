import type { ExperienceRuntimeManifest } from "@repo/shared/experience-runtime";
import { StyleSheet, View } from "react-native";

import { ExperiencePlayer, type ExperiencePlayerProps } from "../components/experience-player";
import { useStoryCommunityAccess } from "../hooks/use-story-community-access";
import { useStoryPreviewAccess } from "../hooks/use-story-preview-access";

type HostProps = Omit<ExperiencePlayerProps, "access" | "runtime"> & {
  runtime: ExperienceRuntimeManifest;
  /**
   * `preview` — local unlock dialog (playtest / Studio parity).
   * `published` — Nest community-access quote + purchase (H5 parity).
   */
  accessMode: "preview" | "published";
};

/**
 * Experience player + story-node community access (H5 commerce.community-points).
 */
export function ExperiencePlayerWithAccess({ runtime, accessMode, ...rest }: HostProps) {
  const preview = useStoryPreviewAccess(rest.locale);
  const commerce = useStoryCommunityAccess(runtime, rest.locale);
  const gate = accessMode === "preview" ? preview : commerce;

  return (
    <View style={styles.host}>
      <ExperiencePlayer {...rest} runtime={runtime} access={gate.access} />
      {gate.dialog}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
});
