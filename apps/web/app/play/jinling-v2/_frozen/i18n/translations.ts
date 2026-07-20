"use client";

import { useCallback } from "react";
import { useLocale } from "@/src/i18n/i18n";
import { defaultLocale } from "@/src/i18n/config";
import { JINLING_MESSAGES } from "./messages";

export { useLocale };

type MessageTree = { [key: string]: string | MessageTree };

function resolveMessage(tree: MessageTree, path: string): string | undefined {
  let node: string | MessageTree | undefined = tree;
  for (const segment of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = node[segment];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * Local stand-in for @/src/i18n/i18n's useTranslations, resolving against the
 * frozen JINLING_MESSAGES bundle instead of the app-wide messages/*.json
 * (the jinlingRumeng subtree no longer exists there). Same call signature,
 * same `{param}` interpolation.
 */
export function useTranslations(ns: string) {
  const locale = useLocale();
  return useCallback(
    (key: string, params?: Record<string, string | number | Date>) => {
      const bundle = (JINLING_MESSAGES[locale as keyof typeof JINLING_MESSAGES] ??
        JINLING_MESSAGES[defaultLocale as keyof typeof JINLING_MESSAGES]) as unknown as MessageTree;
      const fullKey = `${ns}.${key}`.replace(/^jinlingRumeng\.?/, "");
      let message = resolveMessage(bundle, fullKey) ?? `${ns}.${key}`;
      if (params) {
        for (const [name, value] of Object.entries(params)) {
          message = message.replaceAll(`{${name}}`, String(value));
        }
      }
      return message;
    },
    [locale, ns]
  );
}
