import type { FaqCategory, FaqShell } from "../_data";

interface CategoryRailProps {
  categories: FaqCategory[];
  shell: FaqShell;
}

/**
 * Category navigation. Renders **twice** with responsive show/hide:
 *
 *  - Desktop (`lg+`): vertical sticky sidebar on the left, with a per-
 *    category description.
 *  - Mobile (`<lg`): horizontal pill row above the content. Hidden on
 *    desktop so the same anchors aren't duplicated visually.
 *
 * Both are plain `<a href="#cat-…">` anchors — zero JS, zero hydration.
 * The browser handles the smooth scroll via `scroll-behavior: smooth`
 * set globally in the page; the URL hash deep-links to the section
 * (shareable + back-button friendly).
 */
export function CategoryRail({ categories, shell }: CategoryRailProps) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:block">
        <nav aria-label="FAQ categories" className="sticky top-20 space-y-1 pr-4">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.24em] text-muted-foreground">
            {shell.railLabel}
          </p>
          {categories.map((cat) => (
            <a
              key={cat.id}
              href={`#${cat.id}`}
              className="group block rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-border hover:bg-card"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground group-hover:text-primary">
                  {cat.title}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {cat.items.length}
                </span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {cat.description}
              </p>
            </a>
          ))}
        </nav>
      </aside>

      {/* Mobile horizontal scroll */}
      <nav
        aria-label="FAQ categories"
        className="-mx-6 mb-6 overflow-x-auto px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:hidden"
      >
        <ul className="flex w-max gap-2">
          {categories.map((cat) => (
            <li key={cat.id}>
              <a
                href={`#${cat.id}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                {cat.title}
                <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
                  {cat.items.length}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
