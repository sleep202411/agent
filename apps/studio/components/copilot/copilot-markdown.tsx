"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const linkClassName =
  "font-medium text-foreground underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white/70";

function isSafeLink(href: string | undefined): href is string {
  return Boolean(
    href &&
    ((href.startsWith("/") && !href.startsWith("//")) ||
      href.startsWith("#") ||
      /^https?:\/\//i.test(href))
  );
}

function withoutMarkdownNode<Props extends { node?: unknown }>(props: Props): Omit<Props, "node"> {
  const { node, ...elementProps } = props;
  void node;
  return elementProps;
}

const components: Components = {
  a: ({ className, children, href, ...props }) => {
    if (!isSafeLink(href)) {
      return <span className={cn("font-medium text-foreground", className)}>{children}</span>;
    }
    const external = /^https?:\/\//i.test(href);
    return (
      <a
        {...withoutMarkdownNode(props)}
        className={cn(linkClassName, className)}
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
    <code
      {...withoutMarkdownNode(props)}
      className={cn(
        "rounded-md bg-white/[0.07] px-1.5 py-0.5 font-mono text-[0.82em] text-foreground",
        className
      )}
    />
  ),
  h1: ({ className, ...props }) => (
    <h3
      {...withoutMarkdownNode(props)}
      className={cn("mb-2 mt-5 text-base font-semibold first:mt-0", className)}
    />
  ),
  h2: ({ className, ...props }) => (
    <h3
      {...withoutMarkdownNode(props)}
      className={cn("mb-2 mt-5 text-[0.95rem] font-semibold first:mt-0", className)}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      {...withoutMarkdownNode(props)}
      className={cn("mb-1.5 mt-4 text-sm font-semibold first:mt-0", className)}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      {...withoutMarkdownNode(props)}
      className={cn("mb-1.5 mt-3 text-sm font-medium first:mt-0", className)}
    />
  ),
  h5: ({ className, ...props }) => (
    <h4
      {...withoutMarkdownNode(props)}
      className={cn("mb-1 mt-3 text-sm font-medium first:mt-0", className)}
    />
  ),
  h6: ({ className, ...props }) => (
    <h4
      {...withoutMarkdownNode(props)}
      className={cn("mb-1 mt-3 text-sm font-medium first:mt-0", className)}
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
        "my-3 max-w-full overflow-x-auto rounded-xl bg-black/30 p-3 font-mono text-xs leading-5 [&>code]:bg-transparent [&>code]:p-0",
        className
      )}
    />
  ),
  table: ({ className, children, ...props }) => (
    <div className="my-3 max-w-full overflow-x-auto rounded-xl bg-white/[0.025]">
      <table
        {...withoutMarkdownNode(props)}
        className={cn("w-max min-w-full border-collapse text-left", className)}
      >
        {children}
      </table>
    </div>
  ),
  td: ({ className, ...props }) => (
    <td
      {...withoutMarkdownNode(props)}
      className={cn("px-3 py-2 align-top text-foreground/78", className)}
    />
  ),
  th: ({ className, ...props }) => (
    <th
      {...withoutMarkdownNode(props)}
      className={cn("bg-white/[0.055] px-3 py-2 align-top font-medium text-foreground", className)}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      {...withoutMarkdownNode(props)}
      className={cn("my-2 list-disc space-y-0.5 pl-5", className)}
    />
  ),
};

export const CopilotMarkdown = memo(function CopilotMarkdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 max-w-full text-sm leading-6 text-foreground/88 [overflow-wrap:anywhere]",
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
        {children}
      </ReactMarkdown>
    </div>
  );
});
