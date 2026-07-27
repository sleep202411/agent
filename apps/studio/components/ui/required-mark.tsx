/**
 * Required-field marker (DESIGN.md rule 3): a brand-red asterisk after the
 * label of a field whose value is mandatory in the submitted contract —
 * defaulted single-choice groups included. Decorative for AT — pair it with
 * `aria-required` on the control itself.
 */
export function RequiredMark() {
  return (
    <span aria-hidden className="ml-0.5 text-[#E52227]">
      *
    </span>
  );
}
