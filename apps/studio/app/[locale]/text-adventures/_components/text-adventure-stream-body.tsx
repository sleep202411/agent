"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { IconLoader2 } from "@tabler/icons-react";

const STORY_PROSE_CLASS =
  "text-[1.02rem] leading-8 text-white/76 text-pretty sm:text-[1.08rem] [&>*+*]:mt-[1.15em] [&_blockquote]:border-l-2 [&_blockquote]:border-white/15 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-white/56 [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h1]:text-white/90 [&_h2]:text-white/90 [&_h3]:text-white/90 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_strong]:font-semibold [&_strong]:text-white/88";

/** Same reveal strategy as the web player — plain text while streaming, Markdown when done. */
export function TextAdventureStreamBody({
  content,
  streaming,
  generatingLabel,
}: {
  content: string;
  streaming: boolean;
  generatingLabel: string;
}) {
  const [shown, setShown] = useState(streaming ? "" : content);
  const shownRef = useRef(shown);
  const targetRef = useRef(content);

  useEffect(() => {
    targetRef.current = content;
  }, [content]);

  useEffect(() => {
    if (!streaming) {
      shownRef.current = content;
      setShown(content);
      return;
    }

    shownRef.current = "";
    setShown("");

    let raf = 0;
    const tick = () => {
      const want = targetRef.current;
      const have = shownRef.current;
      if (want !== have) {
        if (have.length > 0 && !want.startsWith(have)) {
          shownRef.current = want;
          setShown(want);
        } else {
          const lag = want.length - have.length;
          let step = 1;
          if (lag > 80) step = Math.ceil(lag / 4);
          else if (lag > 32) step = 4;
          else if (lag > 12) step = 2;
          const next = want.slice(0, Math.min(have.length + step, want.length));
          shownRef.current = next;
          setShown(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Only restart the loop when streaming toggles; content is read via targetRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- content snap handled above when !streaming
  }, [streaming]);

  if (streaming) {
    const waiting = !content;
    return (
      <article className={STORY_PROSE_CLASS}>
        {shown ? (
          <p className="whitespace-pre-wrap break-words">
            {shown}
            {!waiting ? (
              <span
                aria-hidden
                className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-0.5 animate-pulse bg-white/55 align-text-bottom motion-reduce:animate-none"
              />
            ) : null}
          </p>
        ) : null}
        {waiting ? (
          <span className="mt-2 inline-flex items-center gap-2 text-sm text-white/40">
            <IconLoader2 className="size-4 animate-spin" />
            {generatingLabel}
          </span>
        ) : null}
      </article>
    );
  }

  if (!content) return null;

  return (
    <article className={STORY_PROSE_CLASS}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </article>
  );
}
