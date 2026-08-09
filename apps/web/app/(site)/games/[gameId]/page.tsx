import type { Metadata } from "next";
import { headers } from "next/headers";
import enUS from "@/messages/en-US.json";
import zhCN from "@/messages/zh-CN.json";
import zhHK from "@/messages/zh-HK.json";
import { defaultLocale, isValidLocale, type Locale } from "@/src/i18n/config";
import { TextGameDetail } from "./_components/text-game-detail";
import { getPublishedTextGame } from "../_data/text-game-api";

type RouteProps = { params: Promise<{ gameId: string }> };

const COPY = {
  "en-US": enUS.textGame,
  "zh-CN": zhCN.textGame,
  "zh-HK": zhHK.textGame,
} satisfies Record<Locale, typeof enUS.textGame>;

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const [{ gameId }, headerBag] = await Promise.all([params, headers()]);
  const localeHeader = headerBag.get("x-locale") ?? defaultLocale;
  const locale = isValidLocale(localeHeader) ? localeHeader : defaultLocale;
  try {
    const game = await getPublishedTextGame(gameId);
    const title = game.content.name || COPY[locale].metadataFallbackTitle;
    const description = game.content.synopsis || COPY[locale].metadataDescription;
    return {
      title,
      description,
      alternates: { canonical: `/games/${encodeURIComponent(gameId)}` },
      ...(game.content.posterUrl
        ? { openGraph: { title, description, images: [{ url: game.content.posterUrl }] } }
        : {}),
    };
  } catch {
    return { title: COPY[locale].metadataFallbackTitle };
  }
}

export default async function TextGameDetailPage({ params }: RouteProps) {
  const { gameId } = await params;
  const game = await getPublishedTextGame(gameId);
  return <TextGameDetail game={game} />;
}
