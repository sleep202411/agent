import Constants from "expo-constants";

export type AppRegion = "global" | "cn";
export type AppVariant = "development" | "preview" | "production";
export type AppLocale = "en-US" | "zh-CN" | "zh-HK";

export type MobileAppEnv = {
  appRegion: AppRegion;
  appVariant: AppVariant;
  siteRegion: AppRegion;
  defaultLocale: AppLocale;
  api: {
    contentBaseUrl: string;
    studioBaseUrl: string;
    auroraBaseUrl: string;
  };
  assets: {
    ossBaseUrl: string;
    userBaseUrl: string;
    bannerBaseUrl: string;
    staticBaseUrl: string;
  };
};

const fallbackEnv: MobileAppEnv = {
  appRegion: "global",
  appVariant: "development",
  siteRegion: "global",
  defaultLocale: "en-US",
  api: {
    contentBaseUrl: "https://fizzdragon.com/content",
    studioBaseUrl: "https://fizzdragon.com/studio",
    auroraBaseUrl: "https://fizzdragon.com/aurora",
  },
  assets: {
    ossBaseUrl: "https://fizzstudio-sg.oss-ap-southeast-1.aliyuncs.com",
    userBaseUrl: "https://user-aratar-sg.oss-ap-southeast-1.aliyuncs.com",
    bannerBaseUrl: "https://fizzdragon-banner-sg.oss-ap-southeast-1.aliyuncs.com",
    staticBaseUrl: "https://static.fizzspace.cn",
  },
};

const configEnv = (Constants.expoConfig?.extra?.appEnv ?? {}) as Partial<MobileAppEnv>;

export const appEnv: MobileAppEnv = {
  ...fallbackEnv,
  ...configEnv,
  api: {
    ...fallbackEnv.api,
    ...configEnv.api,
  },
  assets: {
    ...fallbackEnv.assets,
    ...configEnv.assets,
  },
};

export const isChinaRegion = appEnv.appRegion === "cn";
export const isProductionApp = appEnv.appVariant === "production";

/**
 * Public web origin for this build's region — used to build shareable links
 * (e.g. the share-card QR target). Region is baked at build time via
 * app.config.js / eas.json, so this is a static derivation, NOT runtime-switched.
 */
export const webBaseUrl =
  appEnv.appRegion === "cn" ? "https://fizzdragon.fizzspace.cn" : "https://fizzdragon.com";

export function resolveAssetUrl(path: string, baseUrl: string): string {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("//")) return `https:${path}`;

  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * Resolve manifest asset URIs for native playback.
 * `/aurora/story-projects/.../content` is a Nest redirect to CDN — must hit
 * `auroraBaseUrl`, not the marketing web origin (CN: fizzstudio, not fizzdragon).
 */
export function resolveExperienceAssetUrl(path: string): string {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("//")) return `https:${path}`;

  if (path.startsWith("/aurora/")) {
    const base = appEnv.api.auroraBaseUrl.replace(/\/+$/, "");
    return `${base}${path.slice("/aurora".length)}`;
  }

  if (path.startsWith("/")) return resolveAssetUrl(path, webBaseUrl);
  return path;
}
