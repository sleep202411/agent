import { Alert } from "react-native";

import { openPaywall, type PaywallCategory } from "./paywall-store";

/** Native alert before routing to `/pay`. Cancel stays on the current screen. */
export function promptInsufficientPaywall(input: {
  title: string;
  body: string;
  cancelLabel: string;
  buyLabel: string;
  category: PaywallCategory;
  communityReturnUrl?: string;
}): void {
  Alert.alert(input.title, input.body, [
    { text: input.cancelLabel, style: "cancel" },
    {
      text: input.buyLabel,
      onPress: () =>
        openPaywall({
          category: input.category,
          communityReturnUrl: input.communityReturnUrl,
        }),
    },
  ]);
}
