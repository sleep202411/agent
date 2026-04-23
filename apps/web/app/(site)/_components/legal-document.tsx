import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface LegalDocumentProps {
  title: string;
  subtitle?: string;
  content: string;
}

/**
 * Renders a legal / static document from a markdown string.
 * Shared by privacy-policy / terms-of-service / refund-policy routes.
 *
 * Block conventions the converter emits (maps from legacy Vue schema):
 * - `## Section` — top-level section
 * - `### Subsection` — subtitle
 * - `- **Term**description` — definition list
 * - `> **Title**` followed by `> - ...` — "callout" check-list (styled)
 * - `> ⚠ text` — "important" warning
 * - `1. **Title.** Text` — numbered steps
 */
export function LegalDocument({ title, subtitle, content }: LegalDocumentProps) {
  return (
    <div className="mx-auto max-w-215 px-6 py-12 sm:py-16">
      <header className="mb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-3 text-sm text-muted-foreground sm:text-base">{subtitle}</p>}
      </header>
      <article
        className="
          rounded-2xl border border-border/60 bg-card/40 p-6 sm:p-10
          prose prose-sm max-w-none
          dark:prose-invert
          prose-headings:text-foreground
          prose-h2:mt-10 prose-h2:mb-4 prose-h2:text-xl prose-h2:font-bold
          prose-h3:mt-6 prose-h3:mb-2 prose-h3:text-base prose-h3:font-semibold prose-h3:text-foreground/90
          prose-p:leading-relaxed prose-p:text-muted-foreground
          prose-strong:text-foreground/90 prose-strong:font-semibold
          prose-a:text-primary prose-a:no-underline hover:prose-a:underline
          prose-ul:my-3 prose-li:my-0.5 prose-li:text-muted-foreground
          prose-ol:my-3
          prose-blockquote:border-l-2 prose-blockquote:border-border
          prose-blockquote:bg-muted/30 prose-blockquote:rounded-lg
          prose-blockquote:px-4 prose-blockquote:py-3 prose-blockquote:not-italic
          prose-blockquote:text-foreground/80
        "
      >
        <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
      </article>
    </div>
  );
}
