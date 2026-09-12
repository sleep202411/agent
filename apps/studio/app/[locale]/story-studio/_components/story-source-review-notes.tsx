"use client";

import { useTranslations } from "next-intl";

export function StorySourceReviewNotes({ notes = [] }: { notes?: readonly string[] }) {
  const t = useTranslations("storyStudio.authoringRun");
  if (notes.length === 0) return null;
  return (
    <details className="my-3 rounded-lg bg-white/[0.05] px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium text-white/85">
        {t("sourceReviewNotes", { count: notes.length })}
      </summary>
      <ul className="mt-2 space-y-2 text-xs leading-5 text-white/70">
        {notes.map((note, index) => (
          <li key={index} className="whitespace-pre-wrap break-words">
            {note}
          </li>
        ))}
      </ul>
    </details>
  );
}
