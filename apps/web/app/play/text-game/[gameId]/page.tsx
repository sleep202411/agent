import type { Metadata } from "next";
import { headers } from "next/headers";
import enUS from "@/messages/en-US.json";
import zhCN from "@/messages/zh-CN.json";
import zhHK from "@/messages/zh-HK.json";
import { defaultLocale, isValidLocale, type Locale } from "@/src/i18n/config";
import {
  getPublishedTextGame,
  listPublishedTextGames,
} from "@/app/(site)/games/_data/text-game-api";
import { TextGamePlayer } from "./_components/text-game-player";

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
    return {
      title: game.content.name || COPY[locale].metadataFallbackTitle,
      description: game.content.synopsis || COPY[locale].metadataDescription,
    };
  } catch {
    return { title: COPY[locale].metadataFallbackTitle };
  }
}

export default async function TextGamePlayerPage({ params }: RouteProps) {
  const { gameId } = await params;
  const [game, catalogueResult] = await Promise.all([
    getPublishedTextGame(gameId),
    listPublishedTextGames().catch(() => []),
  ]);
  return <TextGamePlayer key={game.gameId} game={game} catalogue={catalogueResult} />;
}
