import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { CreatorEducation } from "./creator-education";
vi.mock("react-native", () => ({
  Platform: { select: (values: Record<string, unknown>) => values.web ?? values.default },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui", () => ({
  SectionHeader: ({ title }: { title: string }) => <h2>{title}</h2>,
}));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
it("renders structured education and labels ongoing studies", () => {
  const html = renderToStaticMarkup(
    <CreatorEducation
      study={JSON.stringify([
        { schoolName: "Film School", major: "Animation", startDate: "2024-09" },
      ])}
    />
  );
  expect(html).toContain("Film School");
  expect(html).toContain("Animation");
  expect(html).toContain("2024-09 — creatorDetail.present");
});
it("renders legacy school names as text", () => {
  const html = renderToStaticMarkup(
    <CreatorEducation study={"First school\n<script>second</script>"} />
  );
  expect(html).toContain("First school");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("creatorDetail.present");
});
it.each([undefined, "", "[broken", "[{}]"])(
  "omits an empty or malformed education section: %s",
  (study) => {
    expect(renderToStaticMarkup(<CreatorEducation study={study} />)).toBe("");
  }
);
it("shows completed studies without an ongoing label", () => {
  const html = renderToStaticMarkup(
    <CreatorEducation
      study={JSON.stringify([{ schoolName: "School", startDate: "2020-01", endDate: "2023-06" }])}
    />
  );
  expect(html).toContain("2020-01 — 2023-06");
  expect(html).not.toContain("creatorDetail.present");
});
