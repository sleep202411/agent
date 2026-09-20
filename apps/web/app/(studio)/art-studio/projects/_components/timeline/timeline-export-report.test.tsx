import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { TimelineExportReportPanel } from "./timeline-export-report";
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string, args?: { number: number }) => args ? `${key} ${args.number}` : key }));
it("identifies repeated shot IDs by export position and shows individual reasons", () => {
  const html = renderToStaticMarkup(<TimelineExportReportPanel report={{ requestedShots: 3, completedShots: 1, partial: true, issues: [
    { index: 0, shotId: "same", reason: "missing_video" },
    { index: 2, shotId: "same", reason: "encoding_failed" },
  ] }} onDismiss={() => {}} />);
  expect(html).toContain("exportReportShot 1");
  expect(html).toContain("exportReportShot 3");
  expect(html).toContain("exportIssue.missing_video");
  expect(html).toContain("exportIssue.encoding_failed");
  expect(html).toContain("exportReportHelp");
});


it("provides every report and warning message in the actual timeline locale namespace", async () => {
  const locales = await Promise.all([
    import("@/messages/en-US.json"), import("@/messages/zh-CN.json"), import("@/messages/zh-HK.json"),
  ]);
  for (const { default: messages } of locales) {
    for (const key of ["exportReportTitle", "exportReportHelp", "exportReportShot", "exportPartial", "exportPartialDesc"] as const)
      expect(messages.timeline[key]).toBeTruthy();
    for (const reason of ["missing_video", "no_video_track", "probe_failed", "encoding_failed", "no_frames", "cancelled"] as const)
      expect(messages.timeline.exportIssue[reason]).toBeTruthy();
  }
});
