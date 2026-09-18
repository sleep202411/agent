import { Platform } from "react-native";

export function hasStoreKitIapNative(): boolean {
  if (Platform.OS === "web") return false;
  try {
    const iap = require("react-native-iap") as typeof import("react-native-iap");
    return typeof iap.initConnection === "function";
  } catch {
    return false;
  }
}
