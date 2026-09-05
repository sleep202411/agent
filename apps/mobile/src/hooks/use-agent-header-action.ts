import { useRouter } from "expo-router";
import { useMemo } from "react";

import { useAuthGate } from "@/auth";
import type { ScreenHeaderAction } from "@/components/ui";
import { Colors } from "@/constants/theme";
import { useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";

/**
 * Home header + — open the Create hub where users name a project or pick one.
 */
export function useAgentHeaderAction(): ScreenHeaderAction {
  const router = useRouter();
  const t = useTranslations();
  const { requireAuth } = useAuthGate();

  return useMemo(
    () => ({
      symbol: { ios: "plus", android: "add", web: "add" },
      accessibilityLabel: t("agent.open"),
      tintColor: "#FFFFFF",
      buttonBackgroundColor: Colors.dark.brand,
      buttonShape: "circle" as const,
      onPress: () => {
        requireAuth({
          onAuthenticated: () => router.push(toHref("/agent")),
        });
      },
    }),
    [requireAuth, router, t]
  );
}
