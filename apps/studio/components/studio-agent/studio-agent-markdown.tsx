"use client";

import { memo, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

import {
  resolveStudioAgentNodeReference,
  useStudioAgentNodeLinks,
} from "./studio-agent-node-links";

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

/**
 * An inline code span, and the one case where it is more than that.
 *
 * When the surrounding surface knows a node by this name, the span becomes the
 * way to go and look at it — which is what the creator wants the moment the
 * agent says it wrote one. Everything else stays exactly what it was: `exit`,
 * `zh-CN` and `text` appear in the same replies and none of them is a place.
 */
function StudioAgentCode({ className, children, ...props }: ComponentPropsWithoutRef<"code">) {
  const links = useStudioAgentNodeLinks();
  const text = typeof children === "string" ? children : null;
  const nodeId = links && text ? resolveStudioAgentNodeReference(text, links) : null;
  const style = "rounded-md bg-white/[0.07] px-1.5 py-0.5 font-mono text-[0.82em] text-foreground";

  if (!links || !nodeId) {
    return (
      <code {...props} className={cn(style, className)}>
        {children}
      </code>
    );
  }
  return (
    <button
      type="button"
      data-slot="studio-agent-node-link"
      data-node-id={nodeId}
      onClick={() => links.focus(nodeId)}
      className={cn(
        style,
        // Underlined rather than coloured: this canvas is monochrome by design
        // and brand red is never a token here, so "you can act on this" has to
        // be carried by weight and an affordance the pointer confirms.
        "cursor-pointer underline decoration-white/35 decoration-dotted underline-offset-[3px] transition-colors hover:bg-white/[0.14] hover:decoration-white/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70",
        className
      )}
    >
      {children}
    </button>
  );
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
    <StudioAgentCode {...withoutMarkdownNode(props)} className={className} />
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
  h5: ({ className, ...props }) => (
    <h4
      {...withoutMarkdownNode(props)}
      className={cn("mt-3 mb-1 text-sm font-medium first:mt-0", className)}
    />
  ),
  h6: ({ className, ...props }) => (
    <h4
      {...withoutMarkdownNode(props)}
      className={cn("mt-3 mb-1 text-sm font-medium first:mt-0", className)}
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

/**
 * Safe, renderer-owned Markdown for any Studio Agent host.
 *
 * It deliberately does not depend on the legacy Creative Studio Copilot
 * surface. Raw HTML, embedded images, and unsafe navigation protocols are
 * excluded at this shared renderer boundary.
 */
export const StudioAgentMarkdown = memo(function StudioAgentMarkdown({
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
