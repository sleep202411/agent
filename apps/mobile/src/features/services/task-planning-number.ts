/** Empty input clears a planning limit; numeric values must be whole and bounded. */
export function parsePlanningNumber(value: string, max: number): number | null {
  if (!value.trim()) return null;
  if (!/^\d+$/.test(value.trim())) throw new Error("Enter a whole number");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max)
    throw new Error("Planning number is outside its allowed range");
  return parsed;
}
