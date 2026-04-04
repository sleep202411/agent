import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import type { GuideStep } from "./guide-steps";

export function createGuideDriver() {
  return driver({
    showProgress: true,
    animate: true,
    overlayColor: "rgba(0, 0, 0, 0.85)",
    stagePadding: 8,
    stageRadius: 8,
    allowClose: true,
    disableActiveInteraction: true,
    popoverClass: "fizzdragon-guide-popover",
    nextBtnText: "下一步",
    prevBtnText: "上一步",
    doneBtnText: "完成",
  });
}

export function toDriverSteps(steps: GuideStep[]): DriveStep[] {
  return steps.map((step) => ({
    element: step.element,
    popover: {
      title: step.title,
      description: step.description,
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
