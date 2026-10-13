/** Approved FD ranks cover lower ranks; skill/partner certificates remain independent. */
export function coveredQualificationIds(
  levels: readonly { id: number; name: string; type?: number | null }[],
  held: ReadonlySet<number>
): Set<number> {
  const rank = (level: (typeof levels)[number]) => {
    if (level.type !== 1) return 0;
    const match = level.name.trim().match(/^FD\s*[-－–]?\s*(III|IV|II|V|I|[1-5])(?=$|[\s·.・-])/i);
    if (!match) return 0;
    return (
      ({ I: 1, II: 2, III: 3, IV: 4, V: 5 } as Record<string, number>)[match[1]!.toUpperCase()] ??
      Number(match[1])
    );
  };
  const highest = Math.max(0, ...levels.filter((level) => held.has(level.id)).map(rank));
  return new Set([
    ...held,
    ...levels.filter((level) => rank(level) > 0 && rank(level) <= highest).map((level) => level.id),
  ]);
}
