import { useState } from "react";
import { Pressable, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import type { StudioInviteRole } from "./api/studio-invites-api";

// Mirrors official Story project role grants. Effective workspace grants are
// additive; this explains a selection and never authorizes a client action.
const permissions = ["read", "edit", "generate", "review", "publish", "manage"] as const;
const grants: Record<
  Exclude<StudioInviteRole, "admin"> | "owner",
  readonly (typeof permissions)[number][]
> = {
  owner: permissions,
  producer: ["read", "edit", "generate", "review", "publish"],
  editor: ["read", "edit", "generate"],
  reviewer: ["read", "review"],
  viewer: ["read"],
};
export function StoryRoleGuide({ role }: { role: StudioInviteRole }) {
  const [expanded, setExpanded] = useState(false);
  const t = useTranslations(),
    theme = useTheme();
  if (role === "admin") return null;
  return (
    <View style={{ gap: 6 }}>
      <ThemedText type="small">{t(`storyRoleGuide.descriptions.${role}`)}</ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        onPress={() => setExpanded(!expanded)}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <ThemedText type="smallBold">{t("storyRoleGuide.title")}</ThemedText>
      </Pressable>
      {expanded && (
        <View
          style={{
            gap: 8,
            padding: 10,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 8,
          }}
        >
          {(["owner", "producer", "editor", "reviewer", "viewer"] as const).map((guideRole) => (
            <View key={guideRole} style={{ gap: 6 }}>
              <ThemedText type="smallBold">
                {t(guideRole === "owner" ? "studioMembers.owner" : `studioInvites.${guideRole}`)}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t(`storyRoleGuide.descriptions.${guideRole}`)}
              </ThemedText>
              {permissions.map((permission) => (
                <View
                  key={permission}
                  style={{ flexDirection: "row", gap: 8, justifyContent: "space-between" }}
                >
                  <ThemedText type="small" style={{ flex: 1 }}>
                    {t(`storyRoleGuide.capabilities.${permission}`)}
                  </ThemedText>
                  <ThemedText type="small" style={{ flex: 1 }}>
                    {t(
                      grants[guideRole].includes(permission)
                        ? "storyRoleGuide.allowed"
                        : "storyRoleGuide.notAllowed"
                    )}
                  </ThemedText>
                </View>
              ))}
            </View>
          ))}
          <ThemedText type="small" themeColor="textSecondary">
            {t("storyRoleGuide.ownerNote")}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t("storyRoleGuide.scopeNote")}
          </ThemedText>
        </View>
      )}
    </View>
  );
}
