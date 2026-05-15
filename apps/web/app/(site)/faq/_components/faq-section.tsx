import type { FaqCategory } from "../_data";
import { FaqItem } from "./faq-item";

interface FaqSectionProps {
  category: FaqCategory;
  /** Ordinal of the **first** item in this section across the whole
   *  page. Each FaqItem renders its absolute 1..N ordinal instead of
   *  resetting per category, so the visual numbering matches the
   *  `q-N` anchor ids exactly. */
  startOrdinal: number;
}

export function FaqSection({ category, startOrdinal }: FaqSectionProps) {
  return (
    <section id={category.id} className="scroll-mt-20">
      <header className="mb-5">
        <h2 className="text-xl font-bold text-foreground sm:text-2xl">{category.title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{category.description}</p>
      </header>
      <ul className="space-y-3">
        {category.items.map((item, idx) => (
          <li key={item.id}>
            <FaqItem item={item} ordinal={startOrdinal + idx} />
          </li>
        ))}
      </ul>
    </section>
  );
}
