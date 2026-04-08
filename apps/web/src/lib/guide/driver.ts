import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import type { GuideStep } from "./guide-steps";

export interface GuideLabels {
  prev: string;
  next: string;
  done: string;
}

export function createGuideDriver(labels: GuideLabels) {
  return driver({
    showProgress: true,
    animate: true,
    overlayColor: "rgba(0, 0, 0, 0.85)",
    stagePadding: 8,
    stageRadius: 8,
    allowClose: true,
    disableActiveInteraction: true,
    popoverClass: "fizzdragon-guide-popover",
    nextBtnText: labels.next,
    prevBtnText: labels.prev,
    doneBtnText: labels.done,
  });
}

export function toDriverSteps(steps: GuideStep[], t: (key: string) => string): DriveStep[] {
  return steps.map((step) => ({
    element: step.element,
    popover: {
      title: t(step.titleKey),
      description: t(step.descriptionKey),
      side: step.side,
    },
  }));
}

export function highlightElement(options: {
  element: string;
  title: string;
  description: string;
  side?: "top" | "bottom" | "left" | "right";
}) {
  const d = driver({
    animate: true,
    stagePadding: 8,
    stageRadius: 8,
    popoverClass: "fizzdragon-guide-popover",
  });
  d.highlight({
    element: options.element,
    popover: {
      title: options.title,
      description: options.description,
      side: options.side,
    },
  });
  return d;
}
