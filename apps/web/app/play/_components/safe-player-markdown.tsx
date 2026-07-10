"use client";

import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const ALLOWED_MARKDOWN_ELEMENTS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "strong",
  "em",
  "del",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
  "hr",
  "br",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "a",
] as const;

const markdownComponents = {
  h1: ({ children }: { children?: ReactNode }) => (
    <h3 className="mb-3 text-[17px] font-extrabold leading-snug text-white last:mb-0">
      {children}
    </h3>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h3 className="mb-2.5 mt-5 text-[16px] font-extrabold leading-snug text-white first:mt-0 last:mb-0">
      {children}
    </h3>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className="mb-2 mt-4 text-[15px] font-bold leading-snug text-white first:mt-0 last:mb-0">
      {children}
    </h3>
  ),
  h4: ({ children }: { children?: ReactNode }) => (
    <h3 className="mb-2 mt-4 text-[14px] font-bold leading-snug text-white first:mt-0 last:mb-0">
      {children}
    </h3>
  ),
  h5: ({ children }: { children?: ReactNode }) => (
    <h3 className="mb-2 mt-4 text-[14px] font-bold leading-snug text-white first:mt-0 last:mb-0">
      {children}
    </h3>
  ),
  h6: ({ children }: { children?: ReactNode }) => (
    <h3 className="mb-2 mt-4 text-[14px] font-bold leading-snug text-white first:mt-0 last:mb-0">
      {children}
    </h3>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="mb-3 whitespace-pre-line text-[14px] font-medium leading-[1.7] text-white/72 last:mb-0">
      {children}
    </p>
  ),
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="font-extrabold text-white/92">{children}</strong>
  ),
  em: ({ children }: { children?: ReactNode }) => <em className="text-white/78">{children}</em>,
  del: ({ children }: { children?: ReactNode }) => (
    <del className="text-white/58 decoration-white/45">{children}</del>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="mb-3 list-disc space-y-1.5 pl-5 text-[14px] leading-[1.65] text-white/72 last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="mb-3 list-decimal space-y-1.5 pl-5 text-[14px] leading-[1.65] text-white/72 last:mb-0">
      {children}
    </ol>
  ),
  li: ({ children }: { children?: ReactNode }) => <li>{children}</li>,
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="mb-3 border-l-2 border-[#ea2804]/55 pl-3 text-white/65 last:mb-0">
      {children}
    </blockquote>
  ),
  code: ({ children, className }: { children?: ReactNode; className?: string }) => {
    const block = className?.includes("language-");
    return (
      <code
        className={cn(
          "rounded bg-black/35 font-mono text-[12px] text-white/78",
          block ? "block overflow-x-auto p-3" : "px-1.5 py-0.5"
        )}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }: { children?: ReactNode }) => (
    <pre className="mb-3 overflow-x-auto last:mb-0">{children}</pre>
  ),
  hr: () => <hr className="my-4 border-white/[0.08]" />,
  table: ({ children }: { children?: ReactNode }) => (
    <div className="mb-3 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-[12px] text-white/72">{children}</table>
    </div>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className="border border-white/10 bg-black/20 px-2 py-1.5 text-left font-bold text-white/88">
      {children}
    </th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className="border border-white/10 px-2 py-1.5">{children}</td>
  ),
  // Backend-authored links stay non-interactive so generated content cannot
  // navigate the player away from the current session.
  a: ({ children }: { children?: ReactNode }) => (
    <span className="font-semibold text-white/82 underline decoration-white/35">{children}</span>
  ),
};

export function SafePlayerMarkdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 [overflow-wrap:anywhere]", className)}>
      <Markdown
        skipHtml
        allowedElements={[...ALLOWED_MARKDOWN_ELEMENTS]}
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {children}
      </Markdown>
    </div>
  );
}
