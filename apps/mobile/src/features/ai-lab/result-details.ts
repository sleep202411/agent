import type { GenerationJob } from "./jobs-api";

type DetailKey = "aiLab.resultResolution" | "aiLab.resultRatio" | "aiLab.resultDuration";
/** Optional provider metadata must not turn a usable result into a broken details panel. */
export function resultDetails(
  output: GenerationJob["outputs"][number],
  locale: string
): [DetailKey, string][] {
  const rows: [DetailKey, string][] = [];
  const { width, height, durationSeconds } = output;
  if (Number.isSafeInteger(width) && Number.isSafeInteger(height) && width! > 0 && height! > 0) {
    let a = width!,
      b = height!;
    while (b !== 0) {
      const remainder = a % b;
      a = b;
      b = remainder;
    }
    rows.push(
      ["aiLab.resultResolution", `${width} × ${height}`],
      ["aiLab.resultRatio", `${width! / a}:${height! / a}`]
    );
  }
  if (
    output.type !== "image" &&
    typeof durationSeconds === "number" &&
    Number.isFinite(durationSeconds) &&
    durationSeconds >= 0
  ) {
    rows.push([
      "aiLab.resultDuration",
      new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(durationSeconds),
    ]);
  }
  return rows;
}

export function resultCreatedAt(value: string, locale: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
