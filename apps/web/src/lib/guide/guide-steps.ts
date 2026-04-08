export type GuideId = "storyboard" | "timeline" | "script" | "projects";

export interface GuideStep {
  element: string;
  /** Translation key for the step title (under the "guide" namespace) */
  titleKey: string;
  /** Translation key for the step description (under the "guide" namespace) */
  descriptionKey: string;
  side?: "top" | "bottom" | "left" | "right";
}

export const guideSteps: Record<GuideId, GuideStep[]> = {
  storyboard: [
    {
      element: '[data-tour-step="tabs"]',
      titleKey: "storyboard.tabs.title",
      descriptionKey: "storyboard.tabs.description",
      side: "bottom",
    },
    {
      element: '[data-tour-step="storyboard-table"]',
      titleKey: "storyboard.table.title",
      descriptionKey: "storyboard.table.description",
      side: "top",
    },
    {
      element: '[data-tour-step="ai-assistant"]',
      titleKey: "storyboard.aiAssistant.title",
      descriptionKey: "storyboard.aiAssistant.description",
      side: "right",
    },
    {
      element: '[data-tour-step="sidebar"]',
      titleKey: "storyboard.sidebar.title",
      descriptionKey: "storyboard.sidebar.description",
      side: "right",
    },
    {
      element: '[data-tour-step="credits"]',
      titleKey: "storyboard.credits.title",
      descriptionKey: "storyboard.credits.description",
      side: "bottom",
    },
    {
      element: '[data-tour-step="upgrade"]',
      titleKey: "storyboard.upgrade.title",
      descriptionKey: "storyboard.upgrade.description",
      side: "bottom",
    },
  ],
  timeline: [
    {
      element: '[data-tour-step="timeline-preview"]',
      titleKey: "timeline.preview.title",
      descriptionKey: "timeline.preview.description",
      side: "bottom",
    },
    {
      element: '[data-tour-step="timeline-ruler"]',
      titleKey: "timeline.ruler.title",
      descriptionKey: "timeline.ruler.description",
      side: "bottom",
    },
    {
      element: '[data-tour-step="timeline-track"]',
      titleKey: "timeline.track.title",
      descriptionKey: "timeline.track.description",
      side: "top",
    },
  ],
  script: [],
  projects: [],
};
