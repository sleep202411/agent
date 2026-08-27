import type { StoryScreenplayDocument } from "@repo/shared/story-agent";

/**
 * The creator-visible screenplay surface. It renders only the canonical
 * document blocks persisted in the proposal; semantic compiler data never
 * leaks into review-only metrics, ids, or cards.
 */
export function StoryScreenplayDocumentView({
  document,
  embedded = false,
}: {
  document: StoryScreenplayDocument;
  embedded?: boolean;
}) {
  return (
    <article
      className={
        embedded
          ? "w-full py-1 text-sm leading-relaxed text-white/90"
          : "mx-auto w-full max-w-[66ch] px-5 py-7 text-[15px] leading-relaxed text-white/90 sm:px-7 sm:py-9"
      }
    >
      {document.blocks.map((block, index) => {
        const key = `${index}:${block.kind}:${block.text}`;
        if (block.kind === "heading") {
          if (block.level === 1) {
            return (
              <h1
                key={key}
                className="mt-1 mb-4 text-2xl font-semibold tracking-[-0.02em] text-white"
              >
                {block.text}
              </h1>
            );
          }
          if (block.level === 2) {
            return (
              <h2
                key={key}
                className="mt-7 mb-2 text-xl font-semibold tracking-[-0.015em] text-white"
              >
                {block.text}
              </h2>
            );
          }
          return (
            <h3 key={key} className="mt-5 mb-2 text-lg font-semibold text-white">
              {block.text}
            </h3>
          );
        }
        return (
          <p key={key} className="my-1.5 whitespace-pre-wrap text-white/90">
            {block.text}
          </p>
        );
      })}
    </article>
  );
}
