import { IconChevronDown } from "@tabler/icons-react";

import type { FaqItem as FaqItemData } from "../_data";

/**
 * Single Q&A row using the native `<details>` element.
 *
 * Why `<details>` over a JS-state Accordion:
 *  - Works without JavaScript (graceful degradation).
 *  - Native semantic element — LLM crawlers parse it cleanly.
 *  - Content is **always** in the DOM (just CSS-hidden when
 *    collapsed) so search-on-page / "Cmd+F" works across collapsed
 *    sections, and GEO crawlers extract the full answer text.
 *  - Browser handles the open/close animation if `interpolate-size`
 *    is enabled (we set it globally via the parent's CSS).
 *
 * The chevron rotation uses Tailwind's `group-open:` modifier (CSS
 * group selector on the `<details>` element) — pure CSS, no JS.
 */

interface FaqItemProps {
  item: FaqItemData;
  /** 1-based ordinal shown to the left of the question. Cheap visual
   *  anchor that mirrors the "50 questions" framing. */
  ordinal: number;
}

export function FaqItem({ item, ordinal }: FaqItemProps) {
  return (
    <details
      id={item.id}
      className="group rounded-xl border border-border bg-card transition-colors hover:border-primary/30 has-[summary:focus-visible]:border-primary/40 open:border-primary/30"
    >
      <summary className="flex cursor-pointer list-none items-start gap-4 px-5 py-4 outline-none [&::-webkit-details-marker]:hidden">
        <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold tabular-nums text-muted-foreground transition-colors group-open:bg-primary/15 group-open:text-primary">
          {ordinal}
        </span>
        <h3 className="flex-1 text-sm font-semibold text-foreground sm:text-base">
          {item.question}
        </h3>
        <IconChevronDown
          aria-hidden
          className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 group-open:text-primary"
        />
      </summary>
      <div className="border-t border-border/40 px-5 pb-5 pt-4 pl-16 text-sm leading-relaxed text-foreground/80 sm:text-[15px]">
        {/* Plain prose. The answer is one paragraph in the source; if
            future answers carry newlines, swap this for a paragraph
            split. */}
        <p className="whitespace-pre-line">{item.answer}</p>
      </div>
    </details>
  );
}
