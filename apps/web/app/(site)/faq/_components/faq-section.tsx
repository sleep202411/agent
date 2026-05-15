import type { FaqCategory } from "../_data/faqs";
import { FaqItem } from "./faq-item";

interface FaqSectionProps {
  category: FaqCategory;
  /** Ordinal of the **first** item in this section across the whole
   *  page. Lets each FaqItem render its absolute 1-50 ordinal instead
   *  of resetting to 1 per category — preserves the "50 questions"
   *  framing and matches the `q-N` anchor ids. */
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
