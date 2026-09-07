export type AppDownload = {
  platform: "android" | "ios";
  labelKey: "appDownloadAndroid" | "appDownloadIos" | "appDownloadGooglePlay";
  href: string;
  download?: string;
};

/** The mobile app belongs to a deployment site, independently of UI language. */
export const APP_DOWNLOADS_BY_SITE: Readonly<Record<"cn" | "global", readonly AppDownload[]>> = {
  cn: [
    {
      platform: "android",
      labelKey: "appDownloadAndroid",
      href: "https://media.fizzspace.cn/releases/android/fizzdragon-cn-2.2.0-80-0254c347.apk",
      download: "FizzDragon-2.2.0-cn.apk",
    },
    {
      platform: "ios",
      labelKey: "appDownloadIos",
      href: "https://apps.apple.com/cn/app/fizzdragon/id6761763480",
    },
  ],
  global: [
    {
      platform: "android",
      labelKey: "appDownloadGooglePlay",
      href: "https://play.google.com/store/apps/details?id=com.fizzdragon",
    },
    {
      platform: "ios",
      labelKey: "appDownloadIos",
      href: "https://apps.apple.com/sg/app/fizzdragon/id6763720048",
    },
  ],
};
