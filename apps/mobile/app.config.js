const APP_REGIONS = new Set(["global", "cn"]);
const APP_VARIANTS = new Set(["development", "preview", "production"]);
const themeTokens = require("./src/config/theme-tokens.json");

const THEME_COLORS = {
  brand: themeTokens.colors.brand["500"],
  canvas: themeTokens.colors.dark.canvas,
};

const REGION_DEFAULTS = {
  global: {
    displayName: "FizzDragon",
    siteRegion: "global",
    defaultLocale: "en-US",
    scheme: "fizzdragon",
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
  },
  cn: {
    displayName: "FizzDragon",
    siteRegion: "cn",
    defaultLocale: "zh-CN",
    scheme: "fizzdragon-cn",
    api: {
      contentBaseUrl: "https://fizzdragon.fizzspace.cn/content",
      studioBaseUrl: "https://fizzdragon.fizzspace.cn/studio",
      // Nest/aurora now served by the new ACK platform (Java box has no /aurora).
      auroraBaseUrl: "https://fizzstudio.fizzspace.cn/aurora",
    },
    assets: {
      ossBaseUrl: "https://shotive.oss-cn-hangzhou.aliyuncs.com",
      userBaseUrl: "https://avatar.fizzspace.cn",
      bannerBaseUrl: "https://banner.fizzspace.cn",
      staticBaseUrl: "https://static.fizzspace.cn",
    },
  },
};

const IDENTIFIER_ENV = {
  global: {
    ios: "FD_GLOBAL_IOS_BUNDLE_IDENTIFIER",
    android: "FD_GLOBAL_ANDROID_PACKAGE",
    developmentBase: "com.fizzdragon.mobile",
  },
  cn: {
    ios: "FD_CN_IOS_BUNDLE_IDENTIFIER",
    android: "FD_CN_ANDROID_PACKAGE",
    developmentBase: "com.fizzdragon.mobile.cn",
  },
};

function readEnum(name, allowed, fallback) {
  const value = readOptionalEnv(name);

  if (!value) return fallback;
  if (allowed.has(value)) return value;

  throw new Error(`[mobile config] ${name} must be one of: ${Array.from(allowed).join(", ")}`);
}

function readOptionalEnv(name) {
  const value = process.env[name]?.trim();

  return value || undefined;
}

function readRevenueCatAppleKey(appRegion) {
  const specific =
    appRegion === "cn"
      ? readOptionalEnv("EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY_CN")
      : readOptionalEnv("EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY_GLOBAL");

  return specific || readOptionalEnv("EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY") || "";
}

function trimTrailingSlashes(value) {
  return value.replace(/\/+$/, "");
}

function readUrl(name, fallback, variant) {
  const value = trimTrailingSlashes(readOptionalEnv(name) || fallback);

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`[mobile config] ${name} must be an absolute URL, received: ${value}`);
  }

  const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";
  if (!isHttp) {
    throw new Error(`[mobile config] ${name} must use http or https, received: ${value}`);
  }

  const isLocalhost =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]";
  if (variant === "production" && (parsed.protocol !== "https:" || isLocalhost)) {
    throw new Error(`[mobile config] ${name} must be a public https URL for production builds`);
  }

  return value;
}

function validateIdentifier(name, value, platform) {
  const pattern =
    platform === "ios"
      ? /^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z][A-Za-z0-9-]*)+$/
      : /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

  if (!pattern.test(value)) {
    throw new Error(`[mobile config] ${name} is not a valid ${platform} identifier: ${value}`);
  }

  return value;
}

function readIdentifier(region, variant, platform) {
  const regionEnvName = IDENTIFIER_ENV[region][platform];
  const genericEnvName = platform === "ios" ? "FD_IOS_BUNDLE_IDENTIFIER" : "FD_ANDROID_PACKAGE";
  const regionValue = readOptionalEnv(regionEnvName);

  if (variant === "production") {
    if (!regionValue) {
      throw new Error(
        `[mobile config] Missing ${regionEnvName} for production ${region} ${platform} build`,
      );
    }

    return validateIdentifier(regionEnvName, regionValue, platform);
  }

  const value =
    regionValue ||
    readOptionalEnv(genericEnvName) ||
    `${IDENTIFIER_ENV[region].developmentBase}.${variant === "preview" ? "preview" : "dev"}`;

  return validateIdentifier(regionValue ? regionEnvName : genericEnvName, value, platform);
}

function getDisplayName(region, variant) {
  const baseName = readOptionalEnv("FD_APP_DISPLAY_NAME") || REGION_DEFAULTS[region].displayName;

  if (variant === "production") return baseName;

  const regionLabel = region === "cn" ? "CN" : "Global";
  const variantLabel = variant === "preview" ? "Preview" : "Dev";

  return `${baseName} ${regionLabel} ${variantLabel}`;
}

function getScheme(region, variant) {
  const baseScheme = readOptionalEnv("FD_APP_SCHEME") || REGION_DEFAULTS[region].scheme;
  const suffix = variant === "preview" ? "preview" : "dev";
  const scheme = variant === "production" ? baseScheme : `${baseScheme}-${suffix}`;

  if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) {
    throw new Error(`[mobile config] FD_APP_SCHEME must match Expo URL scheme rules: ${scheme}`);
  }

  return scheme;
}

const WECHAT_PROGUARD_RULES = [
  "-keep class com.tencent.mm.opensdk.** {",
  "    *;",
  "}",
  "",
  "-keep class com.tencent.wxop.** {",
  "    *;",
  "}",
  "",
  "-keep class com.tencent.mm.sdk.** {",
  "    *;",
  "}",
  "",
].join("\n");

function getUrlSchemes(region, variant) {
  const appScheme = getScheme(region, variant);
  const wechatAppId = readOptionalEnv("EXPO_PUBLIC_WECHAT_APP_ID");
  if (wechatAppId && /^wx[a-zA-Z0-9]+$/.test(wechatAppId)) {
    return [appScheme, wechatAppId];
  }
  return appScheme;
}

function wechatAssociatedDomain() {
  const raw = readOptionalEnv("EXPO_PUBLIC_WECHAT_UNIVERSAL_LINK");
  if (!raw) return undefined;

  try {
    const host = raw.includes("://")
      ? new URL(raw).host
      : raw.replace(/^\/+|\/+$/g, "").split("/")[0];
    return host ? `applinks:${host}` : undefined;
  } catch {
    return undefined;
  }
}

function readSlug() {
  const slug = readOptionalEnv("FD_EXPO_SLUG") || "fizzdragon";

  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(`[mobile config] FD_EXPO_SLUG must be URL-safe, received: ${slug}`);
  }

  return slug;
}

module.exports = ({ config }) => {
  const appRegion = readEnum("FD_APP_REGION", APP_REGIONS, "global");
  const appVariant = readEnum("APP_VARIANT", APP_VARIANTS, "development");
  const defaults = REGION_DEFAULTS[appRegion];

  const wechatApplink = wechatAssociatedDomain();

  const appEnv = {
    appRegion,
    appVariant,
    siteRegion: defaults.siteRegion,
    defaultLocale: defaults.defaultLocale,
    api: {
      contentBaseUrl: readUrl(
        "EXPO_PUBLIC_API_CONTENT_BASE_URL",
        defaults.api.contentBaseUrl,
        appVariant,
      ),
      studioBaseUrl: readUrl(
        "EXPO_PUBLIC_API_STUDIO_BASE_URL",
        defaults.api.studioBaseUrl,
        appVariant,
      ),
      auroraBaseUrl: readUrl(
        "EXPO_PUBLIC_API_AURORA_BASE_URL",
        defaults.api.auroraBaseUrl,
        appVariant,
      ),
    },
    assets: {
      ossBaseUrl: readUrl("EXPO_PUBLIC_OSS_BASE_URL", defaults.assets.ossBaseUrl, appVariant),
      userBaseUrl: readUrl("EXPO_PUBLIC_USER_BASE_URL", defaults.assets.userBaseUrl, appVariant),
      bannerBaseUrl: readUrl(
        "EXPO_PUBLIC_BANNER_BASE_URL",
        defaults.assets.bannerBaseUrl,
        appVariant,
      ),
      staticBaseUrl: readUrl(
        "EXPO_PUBLIC_STATIC_BASE_URL",
        defaults.assets.staticBaseUrl,
        appVariant,
      ),
    },
  };

  return {
    ...config,
    owner: "fizzdragon",
    name: getDisplayName(appRegion, appVariant),
    slug: readSlug(),
    version: "2.3.2",
    orientation: "default",
    icon: "./assets/images/icon.png",
    scheme: getUrlSchemes(appRegion, appVariant),
    userInterfaceStyle: "dark",
    backgroundColor: THEME_COLORS.canvas,
    primaryColor: THEME_COLORS.brand,
    ios: {
      ...config.ios,
      // iOS-ONLY icon: a full-bleed 1024×1024 opaque poster (no transparency, no
      // pre-baked corners — iOS applies its own squircle mask). iOS has no
      // safe-zone/margin requirement, so the art runs edge to edge. Android keeps
      // its own adaptiveIcon below (Xiaomi et al. DO need a safe-zone margin).
      icon: "./assets/images/ios-icon.png",
      bundleIdentifier: readIdentifier(appRegion, appVariant, "ios"),
      buildNumber: "82",
      // iPhone-only: no iPad/universal build (UIDeviceFamily=[1]). The 1.0
      // rejection was reviewed on an iPad Air; we do not claim tablet support.
      supportsTablet: false,
      userInterfaceStyle: "dark",
      backgroundColor: THEME_COLORS.canvas,
      ...(wechatApplink ? { associatedDomains: [wechatApplink] } : {}),
    },
    android: {
      ...config.android,
      package: readIdentifier(appRegion, appVariant, "android"),
      versionCode: 82,
      userInterfaceStyle: "dark",
      backgroundColor: THEME_COLORS.canvas,
      adaptiveIcon: {
        // Full-bleed poster icon; black behind it so the rounded mask shows no red halo.
        backgroundColor: "#000000",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      bundler: "metro",
      // API routes (`/_mobile-api/*`) need "server" in local web dev. EAS
      // `expo export:embed` for native release builds requires "static".
      output: appVariant === "development" ? "server" : "static",
      favicon: "./assets/images/favicon.png",
      themeColor: THEME_COLORS.canvas,
      backgroundColor: THEME_COLORS.canvas,
    },
    plugins: [
      "expo-router",
      "expo-asset",
      "expo-font",
      [
        "expo-dev-client",
        {
          launchMode: "most-recent",
        },
      ],
      "expo-file-system",
      "expo-image",
      "expo-localization",
      "expo-secure-store",
      "expo-sharing",
      [
        "expo-screen-orientation",
        {
          initialOrientation: "PORTRAIT_UP",
        },
      ],
      "expo-video",
      "expo-audio",
      "expo-document-picker",
      "expo-web-browser",
      [
        "expo-media-library",
        {
          // Only the "save to Photos" permission is needed (share-card download);
          // we never read the user's library, so request add-only access.
          savePhotosPermission: "Allow $(PRODUCT_NAME) to save share images to your photos.",
          photosPermission: "Allow $(PRODUCT_NAME) to save share images to your photos.",
          isAccessMediaLocationEnabled: false,
        },
      ],
      [
        "expo-status-bar",
        {
          style: "light",
        },
      ],
      [
        "expo-splash-screen",
        {
          // FizzDragon white wordmark on the dark brand canvas (all platforms).
          backgroundColor: THEME_COLORS.canvas,
          image: "./assets/images/splash-icon.png",
          imageWidth: 220,
        },
      ],
      [
        "expo-build-properties",
        {
          android: {
            extraProguardRules: WECHAT_PROGUARD_RULES,
          },
        },
      ],
      [
        "expo-wechat",
        {
          enablePay: appRegion === "cn",
        },
      ],
      // Re-applies the Android RELEASE signingConfig on every prebuild (the Expo
      // template otherwise signs release with the debug key → store rejection).
      "./plugins/withAndroidReleaseSigning",
    ],
    experiments: {
      // Disabled: the install-time re-hoist broke expo-router's
      // `_ctx-shared` resolution, so typed-route generation crashed `expo start`
      // and left stale route types. Re-enable after `npx expo install --fix`.
      typedRoutes: false,
      // Disabled: the experimental React Compiler mis-compiled Pressable
      // function styles (style={({pressed}) => [layoutStyle, ...]}), silently
      // dropping the layout so checkboxes/buttons rendered unstyled. Re-enable
      // only after verifying that pattern across the app.
      reactCompiler: false,
    },
    extra: {
      ...config.extra,
      appEnv,
      paywall: {
        revenueCatAppleApiKey: readRevenueCatAppleKey(appRegion),
        revenueCatGoogleApiKey: readOptionalEnv("EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY") || "",
        wechatAppId: readOptionalEnv("EXPO_PUBLIC_WECHAT_APP_ID") || "",
        wechatUniversalLink: readOptionalEnv("EXPO_PUBLIC_WECHAT_UNIVERSAL_LINK") || "",
      },
      eas: {
        ...config.extra?.eas,
        projectId: "00e1e0f0-54fd-4242-86ca-1580d53f90f0",
      },
    },
  };
};
