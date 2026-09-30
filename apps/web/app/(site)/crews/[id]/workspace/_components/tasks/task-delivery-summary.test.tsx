import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { CrewTaskDTO, CrewTaskSubmissionDTO } from "@/app/(site)/crews/_hooks/types";
import { TaskDeliverySummary } from "./task-delivery-summary";
import { TaskDeliveryProgress } from "./task-delivery-progress";
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("next/link", () => ({
  default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
function task(submissions: Partial<CrewTaskSubmissionDTO>[]): CrewTaskDTO {
  return { crewId: "crew", submissions } as CrewTaskDTO;
}
it("shows the latest immutable delivery even if submissions arrive out of order", () => {
  const markup = renderToStaticMarkup(
    <TaskDeliverySummary
      task={task([
        {
          id: "new",
          versionNumber: 2,
          note: "Latest work",
          assets: [],
          professionalDelivery: {
            categoryId: "category",
            version: 2,
            definition: {
              name: "Original requirements",
              fields: [
                {
                  key: "brief",
                  label: "Submitted Brief",
                  type: "text",
                  instructions: "",
                  required: true,
                },
              ],
            },
            answers: { brief: "Original answer" },
          },
        },
        { id: "old", versionNumber: 1, note: "Outdated note", assets: [] },
      ])}
    />
  );
  expect(markup).toContain("Latest work");
  expect(markup).toContain("Original answer");
  expect(markup).not.toContain("Outdated note");
});
it("links only assets present in the authorized submission and marks missing evidence", () => {
  const markup = renderToStaticMarkup(
    <TaskDeliverySummary
      task={task([
        {
          id: "s",
          versionNumber: 1,
          note: "",
          assets: [
            {
              id: "asset",
              name: "Final.mov",
              mediaAssetId: null,
              contentType: "video/quicktime",
              sizeBytes: 1,
            },
          ],
          professionalDelivery: {
            categoryId: "category",
            version: 1,
            definition: {
              name: "Video",
              fields: [
                {
                  key: "video",
                  label: "Video",
                  type: "attachment",
                  instructions: "",
                  required: true,
                },
              ],
            },
            answers: { video: ["asset", "missing"] },
          },
        },
      ])}
    />
  );
  expect(markup).toContain("Final.mov");
  expect(markup).toContain("asset=asset");
  expect(markup).not.toContain("asset=missing");
  expect(markup).toContain("unavailableFile");
});
it("does not invent delivery evidence before a submission", () => {
  expect(renderToStaticMarkup(<TaskDeliverySummary task={task([])} />)).toBe("");
});
it("labels an unstarted or cancelled task honestly", () => {
  expect(renderToStaticMarkup(<TaskDeliveryProgress status="open" />)).toContain("notStarted");
  const cancelled = renderToStaticMarkup(<TaskDeliveryProgress status="cancelled" />);
  expect(cancelled).toContain("cancelled");
  expect(cancelled).not.toContain('aria-current="step"');
});
it("distinguishes a returned submission from approval", () => {
  const revision = renderToStaticMarkup(<TaskDeliveryProgress status="revision_requested" />);
  expect(revision).toContain("revision");
  expect(revision).not.toContain("approved");
  expect(renderToStaticMarkup(<TaskDeliveryProgress status="approved" />)).toContain("approved");
});
