import { describe, expect, it } from "vitest";
import {
  frameSizeOfRect,
  isPhoneDevice,
  screenDeltaInFrame,
  screenPointInFrame,
  shouldRotateFrame,
  type ExperienceDeviceEnvironment,
} from "./experience-landscape-presentation";

/** A device as the browser describes it: input capabilities, screen, Client Hints. */
function device(input: {
  coarseWithoutHover: boolean;
  screen: [number, number];
  userAgentData?: { mobile?: boolean };
}): ExperienceDeviceEnvironment {
  return {
    matchMedia: (query) => ({
      matches: query === "(pointer: coarse) and (hover: none)" && input.coarseWithoutHover,
    }),
    screen: { width: input.screen[0], height: input.screen[1] },
    navigator: input.userAgentData ? { userAgentData: input.userAgentData } : {},
  };
}

describe("isPhoneDevice", () => {
  it.each([
    [
      "a desktop with a mouse",
      device({ coarseWithoutHover: false, screen: [1512, 982], userAgentData: { mobile: false } }),
      false,
    ],
    // A desktop window dragged narrow is still a desktop: the decision never
    // reads the window.
    ["a narrow desktop window", device({ coarseWithoutHover: false, screen: [1512, 982] }), false],
    ["an iPhone (no Client Hints)", device({ coarseWithoutHover: true, screen: [390, 844] }), true],
    ["an iPhone held sideways", device({ coarseWithoutHover: true, screen: [844, 390] }), true],
    [
      "an Android phone reporting mobile",
      device({ coarseWithoutHover: true, screen: [412, 915], userAgentData: { mobile: true } }),
      true,
    ],
    [
      "an iPad (744 on its short side)",
      device({ coarseWithoutHover: true, screen: [744, 1133] }),
      false,
    ],
    [
      "an Android tablet reporting not mobile",
      device({ coarseWithoutHover: true, screen: [800, 1280], userAgentData: { mobile: false } }),
      false,
    ],
    // Client Hints win over the screen wherever the browser has them.
    [
      "a small Android tablet reporting not mobile",
      device({ coarseWithoutHover: true, screen: [540, 960], userAgentData: { mobile: false } }),
      false,
    ],
  ])("%s → %s", (_label, environment, expected) => {
    expect(isPhoneDevice(environment)).toBe(expected);
  });
});

describe("shouldRotateFrame", () => {
  const phoneFilm = { landscapeFilm: true, phone: true };

  it.each([
    ["phone upright, no lock", { ...phoneFilm, portrait: true, locked: false }, true],
    ["phone held sideways", { ...phoneFilm, portrait: false, locked: false }, false],
    // The lock turns the screen itself; the media query may lag it.
    ["phone upright, lock held", { ...phoneFilm, portrait: true, locked: true }, false],
    [
      "desktop with a narrow window",
      { landscapeFilm: true, phone: false, portrait: true, locked: false },
      false,
    ],
    [
      "portrait film on an upright phone",
      { landscapeFilm: false, phone: true, portrait: true, locked: false },
      false,
    ],
  ])("%s → %s", (_label, input, expected) => {
    expect(shouldRotateFrame(input)).toBe(expected);
  });
});

describe("screen readings in the frame's own axes", () => {
  // A 693×390 stage turned clockwise on a 390×844 phone screen: its screen
  // rect is 390 wide and 693 tall, centred on the screen.
  const rect = { left: 0, top: 75.5, right: 390, width: 390, height: 693 };

  it("swaps a turned box back", () => {
    expect(frameSizeOfRect(rect, true)).toEqual({ width: 693, height: 390 });
    expect(frameSizeOfRect(rect, false)).toEqual({ width: 390, height: 693 });
  });

  it("maps the frame's corners from where a clockwise turn puts them", () => {
    // Top-left of the picture: the screen rect's top-right corner.
    expect(screenPointInFrame(rect, 390, 75.5, true)).toEqual({ x: 0, y: 0 });
    // Top-right of the picture: bottom-right of the screen rect.
    expect(screenPointInFrame(rect, 390, 768.5, true)).toEqual({ x: 693, y: 0 });
    // Bottom-left of the picture: top-left of the screen rect.
    expect(screenPointInFrame(rect, 0, 75.5, true)).toEqual({ x: 0, y: 390 });
    expect(screenPointInFrame(rect, 10, 85.5, false)).toEqual({ x: 10, y: 10 });
  });

  it("turns a movement down the screen into one toward the picture's right", () => {
    expect(screenDeltaInFrame(0, 50, true)).toEqual({ x: 50, y: -0 });
    expect(screenDeltaInFrame(-50, 0, true)).toEqual({ x: 0, y: 50 });
    expect(screenDeltaInFrame(0, 50, false)).toEqual({ x: 0, y: 50 });
  });
});
