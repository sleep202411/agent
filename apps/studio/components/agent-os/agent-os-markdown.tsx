"use client";

import { memo, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/**
 * Light normalize for model quirks before Markdown:
 * - literal `<br>` (models often emit HTML breaks inside MD tables)
 * - collapse excessive blank lines so side-panel height stays sane
 */
export function prepareAgentOsMarkdown(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&lt;br\s*\/?&gt;/gi, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trimEnd();
}

function withoutMarkdownNode<Props extends { node?: unknown }>(props: Props): Omit<Props, "node"> {
  const { node, ...elementProps } = props;
  void node;
  return elementProps;
}

function isSafeLink(href: string | undefined): href is string {
  return Boolean(
    href &&
    ((href.startsWith("/") && !href.startsWith("//")) ||
      href.startsWith("#") ||
      /^https?:\/\//i.test(href))
  );
}

const linkClassName =
  "font-medium text-foreground underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white/70";

/** Inline code — must wrap in a ~480px panel (model often puts long ids here). */
function AgentOsCode({ className, children, ...props }: ComponentPropsWithoutRef<"code">) {
  const isBlock = Boolean(className?.includes("language-"));
  return (
    <code
      {...props}
      className={cn(
        isBlock
          ? "font-mono text-[0.82em] text-foreground"
          : "rounded-md bg-white/[0.07] px-1.5 py-0.5 font-mono text-[0.82em] text-foreground break-all [overflow-wrap:anywhere]",
        className
      )}
    >
      {children}
    </code>
  );
}

/**
 * Narrow-panel Markdown for Agent OS.
 *
 * Deliberately tighter than Studio Agent canvas markdown:
 * - no page-level horizontal scroll from long `code` or wide GFM tables
 * - tables stay within the bubble (cells wrap; table can still scroll *inside*
 *   a max-width container if truly wide, without expanding the chat column)
 */
const components: Components = {
  a: ({ className, children, href, ...props }) => {
    if (!isSafeLink(href)) {
      return <span className={cn("font-medium text-foreground", className)}>{children}</span>;
    }
    const external = /^https?:\/\//i.test(href);
    return (
      <a
        {...withoutMarkdownNode(props)}
        className={cn(linkClassName, "break-all", className)}
        href={href}
        rel={external ? "noreferrer noopener" : undefined}
        target={external ? "_blank" : undefined}
      >
        {children}
      </a>
    );
  },
  blockquote: ({ className, ...props }) => (
    <blockquote
      {...withoutMarkdownNode(props)}
      className={cn("my-3 rounded-xl bg-white/[0.045] px-3.5 py-2.5 text-foreground/72", className)}
    />
  ),
  code: ({ className, ...props }) => (
    <AgentOsCode {...withoutMarkdownNode(props)} className={className} />
  ),
  h1: ({ className, ...props }) => (
    <h3
      {...withoutMarkdownNode(props)}
      className={cn("mt-5 mb-2 text-base font-semibold first:mt-0", className)}
    />
  ),
  h2: ({ className, ...props }) => (
    <h3
      {...withoutMarkdownNode(props)}
      className={cn("mt-5 mb-2 text-[0.95rem] font-semibold first:mt-0", className)}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      {...withoutMarkdownNode(props)}
      className={cn("mt-4 mb-1.5 text-sm font-semibold first:mt-0", className)}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      {...withoutMarkdownNode(props)}
      className={cn("mt-3 mb-1.5 text-sm font-medium first:mt-0", className)}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr
      {...withoutMarkdownNode(props)}
      className={cn("my-4 h-px border-0 bg-white/[0.08]", className)}
    />
  ),
  li: ({ className, ...props }) => (
    <li
      {...withoutMarkdownNode(props)}
      className={cn("my-1 pl-0.5 marker:text-foreground/40", className)}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      {...withoutMarkdownNode(props)}
      className={cn("my-2 list-decimal space-y-0.5 pl-5", className)}
    />
  ),
  p: ({ className, ...props }) => (
    <p {...withoutMarkdownNode(props)} className={cn("my-2 first:mt-0 last:mb-0", className)} />
  ),
  pre: ({ className, ...props }) => (
    <pre
      {...withoutMarkdownNode(props)}
      className={cn(
        "my-3 max-w-full overflow-x-auto rounded-xl bg-black/30 p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all [&>code]:bg-transparent [&>code]:p-0",
        className
      )}
    />
  ),
  // GFM tables: wrap cells, never force the chat column wider than the panel.
  table: ({ className, children, ...props }) => (
    <div className="my-3 w-full max-w-full min-w-0 overflow-x-auto rounded-xl bg-white/[0.025]">
      <table
        {...withoutMarkdownNode(props)}
        className={cn("w-full max-w-full border-collapse table-fixed text-left", className)}
      >
        {children}
      </table>
    </div>
  ),
  td: ({ className, ...props }) => (
    <td
      {...withoutMarkdownNode(props)}
      className={cn(
        "px-2.5 py-2 align-top text-foreground/78 break-words [overflow-wrap:anywhere]",
        className
      )}
    />
  ),
  th: ({ className, ...props }) => (
    <th
      {...withoutMarkdownNode(props)}
      className={cn(
        "bg-white/[0.055] px-2.5 py-2 align-top font-medium text-foreground break-words [overflow-wrap:anywhere]",
        className
      )}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      {...withoutMarkdownNode(props)}
      className={cn("my-2 list-disc space-y-0.5 pl-5", className)}
    />
  ),
};

/**
 * Agent OS assistant body — GFM for the ~480px side panel.
 * Prefer wrapping over page-level horizontal scroll.
 */
export const AgentOsMarkdown = memo(function AgentOsMarkdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 max-w-full overflow-x-hidden text-sm leading-6 text-foreground/88 [overflow-wrap:anywhere]",
        className
      )}
    >
      <ReactMarkdown
        components={components}
        disallowedElements={["img"]}
        remarkPlugins={[remarkGfm]}
        skipHtml
        unwrapDisallowed
      >
        {prepareAgentOsMarkdown(children)}
      </ReactMarkdown>
    </div>
  );
});
