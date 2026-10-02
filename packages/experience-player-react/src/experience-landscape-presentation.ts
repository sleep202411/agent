import { createContext, useCallback, useEffect, useRef, useState } from "react";

/** The slice of the browser `isPhoneDevice` reads, injected so it can be tested. */
export interface ExperienceDeviceEnvironment {
  matchMedia(query: string): { matches: boolean };
  screen: { width: number; height: number };
  navigator: { userAgentData?: { mobile?: boolean } };
}

/** Phones sit well under this on their short side; the smallest tablet is 744. */
const PHONE_SHORT_SIDE_MAX_PX = 600;

/**
 * Whether the viewer is holding a phone — the one device a landscape film is
 * turned for. Decided by the device, never by the size of the window or the
 * player: a narrow desktop window and a tablet both letterbox instead.
 *
 * A touchscreen without hover is a phone or a tablet. User-Agent Client Hints
 * say which wherever the browser has them; elsewhere (Safari, most in-app
 * browsers) the screen's short side does.
 */
export function isPhoneDevice(env: ExperienceDeviceEnvironment): boolean {
  if (!env.matchMedia("(pointer: coarse) and (hover: none)").matches) return false;
  const hints = env.navigator.userAgentData;
  if (hints) return hints.mobile === true;
  return Math.min(env.screen.width, env.screen.height) < PHONE_SHORT_SIDE_MAX_PX;
}

/**
 * Whether the film frame is drawn sideways: a landscape film, on a phone held
 * upright, whose screen the browser would not turn. Once fullscreen and the
 * orientation lock both hold, the screen itself is landscape and nothing is
 * rotated, whatever the orientation media query has caught up with.
 */
export function shouldRotateFrame(input: {
  landscapeFilm: boolean;
  phone: boolean;
  portrait: boolean;
  locked: boolean;
}): boolean {
  return input.landscapeFilm && input.phone && input.portrait && !input.locked;
}

/**
 * Whether the film frame around a component is drawn sideways — a 90° clockwise
 * turn, the only one the player applies. Layout inside the frame is untouched
 * by it, but anything that reads the screen (client rects, pointer positions)
 * gets readings in the screen's axes and has to turn them back into the
 * frame's own, or cues land in the wrong place and swipes in the wrong
 * direction.
 */
export const ExperienceFrameRotationContext = createContext(false);

/** An element's box in the frame's own axes, from its screen rect. */
export function frameSizeOfRect(
  rect: { width: number; height: number },
  rotated: boolean
): { width: number; height: number } {
  return rotated
    ? { width: rect.height, height: rect.width }
    : { width: rect.width, height: rect.height };
}

/**
 * A screen point in the frame's own axes, relative to the element `rect`
 * measures. Turned clockwise, the element's top-left corner sits at the
 * screen rect's top-right, its x axis runs down the screen and its y axis
 * runs right to left.
 */
export function screenPointInFrame(
  rect: { left: number; top: number; right: number },
  clientX: number,
  clientY: number,
  rotated: boolean
): { x: number; y: number } {
  return rotated
    ? { x: clientY - rect.top, y: rect.right - clientX }
    : { x: clientX - rect.left, y: clientY - rect.top };
}

/** A pointer movement on screen, in the frame's own axes. */
export function screenDeltaInFrame(
  deltaX: number,
  deltaY: number,
  rotated: boolean
): { x: number; y: number } {
  return rotated ? { x: deltaY, y: -deltaX } : { x: deltaX, y: deltaY };
}

export interface ExperienceLandscapePresentation {
  /** The viewer holds a phone. Decided after mount; false on the server. */
  readonly phone: boolean;
  /** The phone is upright right now. Only tracked on phones. */
  readonly portrait: boolean;
  /** Fullscreen and the landscape lock both hold: the screen itself is turned. */
  readonly locked: boolean;
  /**
   * Asks the browser to turn the screen: fullscreen on the player, then a
   * landscape lock. Must run inside the viewer's click — both need the user
   * activation it carries. Never waited on: playback starts alongside it.
   */
  enter(shell: HTMLElement | null): void;
  /** Releases the lock, and leaves fullscreen if `enter` is what entered it. */
  exit(): void;
}

interface LandscapeSession {
  readonly shell: HTMLElement;
  fullscreen: boolean;
  orientationLock: boolean;
}

/** `lock()` is missing from the DOM typings: only some engines ship it. */
interface LockableScreenOrientation {
  lock(orientation: "landscape"): Promise<void>;
  unlock(): void;
}

/**
 * A phone always presents a landscape film in landscape. Where the browser
 * lets the player take the screen (fullscreen plus an orientation lock, e.g.
 * Chrome on Android) the screen turns and the frame is drawn normally; where it
 * refuses (Safari on iPhone, many in-app browsers) the frame is drawn sideways
 * for as long as the phone is upright — see shouldRotateFrame.
 *
 * Only what `enter` took is given back: the lock it requested and the
 * fullscreen it entered, on exit, on unmount, or as soon as the viewer leaves
 * fullscreen themselves.
 */
export function useLandscapePresentation(): ExperienceLandscapePresentation {
  const [phone, setPhone] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [locked, setLocked] = useState(false);
  const sessionRef = useRef<LandscapeSession | null>(null);

  useEffect(() => {
    setPhone(
      isPhoneDevice({
        matchMedia: (query) => window.matchMedia(query),
        screen: window.screen,
        navigator: window.navigator as Navigator & { userAgentData?: { mobile?: boolean } },
      })
    );
  }, []);

  useEffect(() => {
    if (!phone) return;
    const query = window.matchMedia("(orientation: portrait)");
    const update = () => setPortrait(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [phone]);

  const exit = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    setLocked(false);
    if (session) releaseLandscapeSession(session);
  }, []);

  const enter = useCallback((shell: HTMLElement | null) => {
    if (!shell || sessionRef.current) return;
    const session: LandscapeSession = { shell, fullscreen: false, orientationLock: false };
    sessionRef.current = session;
    const fullscreen = requestFullscreen(shell);
    if (!fullscreen) return;
    void fullscreen
      .then(() => {
        session.fullscreen = true;
        // Exited while the request was in flight: give the screen straight back.
        if (sessionRef.current !== session) {
          releaseLandscapeSession(session);
          return;
        }
        const orientation = lockableScreenOrientation();
        if (!orientation) return;
        session.orientationLock = true;
        return orientation.lock("landscape").then(() => {
          if (sessionRef.current === session) setLocked(true);
        });
      })
      .catch(() => {
        // Refused or unsupported: the frame is drawn sideways instead, so there
        // is nothing to report — the viewer still gets a landscape film.
      });
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      const session = sessionRef.current;
      if (!session?.fullscreen || document.fullscreenElement === session.shell) return;
      // The viewer left (back gesture, Escape). The browser drops the lock
      // with fullscreen; the frame falls back to being drawn sideways.
      sessionRef.current = null;
      session.fullscreen = false;
      releaseLandscapeSession(session);
      setLocked(false);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => exit, [exit]);

  return { phone, portrait, locked, enter, exit };
}

function requestFullscreen(shell: HTMLElement): Promise<void> | null {
  if (typeof shell.requestFullscreen !== "function") return null;
  try {
    return Promise.resolve(shell.requestFullscreen({ navigationUI: "hide" }));
  } catch {
    return null;
  }
}

function lockableScreenOrientation(): LockableScreenOrientation | null {
  if (typeof screen === "undefined") return null;
  const orientation = screen.orientation as Partial<LockableScreenOrientation> | undefined;
  return typeof orientation?.lock === "function" && typeof orientation.unlock === "function"
    ? (orientation as LockableScreenOrientation)
    : null;
}

function releaseLandscapeSession(session: LandscapeSession): void {
  if (session.orientationLock) {
    session.orientationLock = false;
    try {
      lockableScreenOrientation()?.unlock();
    } catch {
      // Already released with fullscreen.
    }
  }
  if (session.fullscreen) {
    session.fullscreen = false;
    if (document.fullscreenElement === session.shell) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }
}
