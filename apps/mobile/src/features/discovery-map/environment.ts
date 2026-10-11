import Constants from "expo-constants";
import { appEnv } from "@/config";
import { parseDiscoveryMapConfig } from "./config";
export function readDiscoveryMapConfig() {
  return parseDiscoveryMapConfig(
    Constants.expoConfig?.extra?.discoveryMap,
    appEnv.appRegion,
    appEnv.appVariant === "production"
  );
}
