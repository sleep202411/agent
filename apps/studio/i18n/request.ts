import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

/**
 * Per-request i18n config. With URL routing, next-intl supplies the locale from
 * the path segment via `requestLocale`; we validate it against the supported
 * set and fall back to the default, then load the matching catalog.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  const [studio, web] = await Promise.all([
    import(`../messages/${locale}.json`),
    import(`../../web/messages/${locale}.json`),
  ]);
  // Subtitle copy has one canonical catalogue, as required by root AGENTS.md.
  return {
    locale,
    messages: {
      ...studio.default,
      storyStudio: { ...studio.default.storyStudio, subtitles: web.default.storyStudio.subtitles },
      experiencePlayer: {
        ...studio.default.experiencePlayer,
        video: {
          ...studio.default.experiencePlayer.video,
          subtitles: web.default.experiencePlayer.video.subtitles,
        },
      },
    },
  };
});
