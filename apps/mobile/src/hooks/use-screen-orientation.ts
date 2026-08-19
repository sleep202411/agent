import { useFocusEffect, useNavigation } from "expo-router";
// Not re-exported from the expo-router root; native-stack needs this hook
// instead of a raw `beforeRemove` listener to hold the pop.
import { usePreventRemove } from "expo-router/build/react-navigation/core/usePreventRemove";
import * as ScreenOrientation from "expo-screen-orientation";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { Dimensions, Platform, type LayoutChangeEvent } from "react-native";

/**
 * How long to wait for a rotation to land after a single lock.
 * `getOrientationAsync` only reports the new value once the transition
 * completes, so a lock that is working still looks unapplied for a few hundred ms.
 * Never re-lock when this elapses — that snaps iOS back through portrait on play enter.
 */
const ORIENTATION_WAIT_TIMEOUT_MS = 1_200;
/**
 * NativeTabs re-layouts after its remount, which Dimensions cannot report —
 * the window is already portrait before the pop.
 */
const POST_REMOUNT_SETTLE_MS = 320;
/** Cadence of the geometry / lock read-back while a rotation lands. */
const ORIENTATION_POLL_MS = 50;
/** How long the portrait restore has to hold before the exit trusts it. */
const ORIENTATION_STABLE_MS = 220;
/** Upper bound on that confirmation, so a misreporting device cannot stall the exit. */
const ORIENTATION_CONFIRM_TIMEOUT_MS = 600;

type OrientationTarget = "portrait" | "landscape";

const LOCK_FOR: Record<OrientationTarget, ScreenOrientation.OrientationLock> = {
  portrait: ScreenOrientation.OrientationLock.PORTRAIT_UP,
  landscape: ScreenOrientation.OrientationLock.LANDSCAPE,
};

/**
 * The requested lock is the only authoritative statement of where the window is
 * heading, so it vetoes a geometry sample taken mid-rotation. Android's native
 * lock enum is ordered differently from the JS one, but the two agree on which
 * members are portrait and which are landscape — classify by family, never by
 * the exact member.
 */
const PORTRAIT_LOCKS: ReadonlySet<ScreenOrientation.OrientationLock> = new Set([
  ScreenOrientation.OrientationLock.PORTRAIT,
  ScreenOrientation.OrientationLock.PORTRAIT_UP,
  ScreenOrientation.OrientationLock.PORTRAIT_DOWN,
]);
const LANDSCAPE_LOCKS: ReadonlySet<ScreenOrientation.OrientationLock> = new Set([
  ScreenOrientation.OrientationLock.LANDSCAPE,
  ScreenOrientation.OrientationLock.LANDSCAPE_LEFT,
  ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT,
]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (remaining: number) => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => step(remaining - 1));
    };
    step(count);
  });
}

function windowMatches(target: OrientationTarget): boolean {
  const { width, height } = Dimensions.get("window");
  return target === "portrait" ? height >= width : width > height;
}

async function lockContradicts(target: OrientationTarget): Promise<boolean> {
  try {
    const lock = await ScreenOrientation.getOrientationLockAsync();
    return target === "portrait" ? LANDSCAPE_LOCKS.has(lock) : PORTRAIT_LOCKS.has(lock);
  } catch {
    return false;
  }
}

async function displayMatches(target: OrientationTarget): Promise<boolean> {
  try {
    const current = await ScreenOrientation.getOrientationAsync();
    return target === "portrait"
      ? current === ScreenOrientation.Orientation.PORTRAIT_UP ||
          current === ScreenOrientation.Orientation.PORTRAIT_DOWN
      : current === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
          current === ScreenOrientation.Orientation.LANDSCAPE_RIGHT;
  } catch {
    return false;
  }
}

/**
 * One "the window is where we asked it to be" sample.
 *
 * The requested-lock veto applies to the portrait restore only. On the way into
 * play the lock we just wrote is trivially in agreement, so reading it back buys
 * nothing — and treating a slow read as disagreement would push the landscape
 * attempt into a re-lock, which is the one thing that visibly bounces.
 */
async function orientationHolds(target: OrientationTarget): Promise<boolean> {
  if (target === "portrait" && (await lockContradicts("portrait"))) return false;
  if (windowMatches(target)) return true;
  return displayMatches(target);
}

/**
 * A rotation attempt. Attempts are serialized, and a superseded one is cancelled
 * rather than left racing: every native write happens inside `requestChain` and
 * re-checks `cancelled` immediately before writing, so the newest request is
 * always the last to write. That is what stops a landscape retry from landing
 * after the play exit has already restored portrait — the stale lock used to
 * survive the pop and rotate whichever screen came next.
 */
type OrientationRequest = {
  target: OrientationTarget;
  reason: string;
  cancelled: boolean;
};

let activeRequest: OrientationRequest | null = null;
let requestChain: Promise<unknown> = Promise.resolve();

/** Resolves to whether the rotation actually committed. */
function applyOrientation(target: OrientationTarget, reason: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(true);

  if (activeRequest) activeRequest.cancelled = true;
  const request: OrientationRequest = { target, reason, cancelled: false };
  activeRequest = request;
  const run = requestChain.then(() => runOrientationRequest(request));
  requestChain = run.catch(() => undefined);
  return run;
}

async function runOrientationRequest(request: OrientationRequest): Promise<boolean> {
  if (request.cancelled) return false;
  // Lock exactly once. A second `lockAsync` while iOS is still animating
  // `requestGeometryUpdate` snaps through the previous orientation first —
  // landscape → portrait → landscape on play enter (release builds hit this often).
  if (!(await lockOrientation(request))) return false;
  if (request.cancelled) return false;
  if (await awaitOrientationMatch(request, ORIENTATION_WAIT_TIMEOUT_MS)) {
    return confirmOrientation(request);
  }
  if (request.cancelled) return false;
  if (request.target === "landscape") {
    console.warn(
      `[orientation] ${request.reason} slow; lock held — waiting on layout, not re-locking`
    );
    return true;
  }
  console.warn(
    `[orientation] ${request.reason} did not settle within ${ORIENTATION_WAIT_TIMEOUT_MS}ms`
  );
  return false;
}

/** Writes the lock unless the request has already been superseded. */
async function lockOrientation(request: OrientationRequest): Promise<boolean> {
  if (request.cancelled) return false;
  try {
    await ScreenOrientation.lockAsync(LOCK_FOR[request.target]);
    return true;
  } catch (error: unknown) {
    console.warn(`[orientation] ${request.reason} failed`, error);
    return false;
  }
}

/** Wait for the first sample that agrees. Never re-locks. */
async function awaitOrientationMatch(
  request: OrientationRequest,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (request.cancelled) return false;
    if (await orientationHolds(request.target)) return true;
    if (request.cancelled || Date.now() >= deadline) return false;
    await delay(ORIENTATION_POLL_MS);
  }
}

/**
 * Portrait only: require the window to *stay* portrait for a moment before the
 * restore reports success. Android publishes new window metrics a frame before
 * applying a configuration change that is still queued, so the first agreeing
 * sample can describe a window that is about to rotate away again — which is how
 * a play exit used to hand the next screen a window still able to rotate.
 *
 * Deliberately never re-locks and never fails the request into the retry path:
 * the caller already has the orientation it asked for, this only decides how long
 * to keep the exit's black cover up.
 */
async function confirmOrientation(request: OrientationRequest): Promise<boolean> {
  if (request.target !== "portrait") return true;

  const deadline = Date.now() + ORIENTATION_CONFIRM_TIMEOUT_MS;
  let holdingSince: number | null = null;

  while (Date.now() < deadline) {
    await delay(ORIENTATION_POLL_MS);
    if (request.cancelled) return false;
    if (await orientationHolds("portrait")) {
      holdingSince ??= Date.now();
      if (Date.now() - holdingSince >= ORIENTATION_STABLE_MS) return true;
    } else {
      holdingSince = null;
    }
  }
  return false;
}

/** Play exit must not pop until portrait is real — callers keep the black cover up. */
async function restorePortraitForExit(reason: string): Promise<boolean> {
  if (Platform.OS === "web") return true;

  if (await applyOrientation("portrait", reason)) return true;

  // Last resort: one direct lock + poll. Still no second retry loop — that is
  // what causes the landscape → portrait → landscape bounce on iOS.
  const fallback: OrientationRequest = {
    target: "portrait",
    reason: `${reason} fallback`,
    cancelled: false,
  };
  if (!(await lockOrientation(fallback))) return false;

  const deadline = Date.now() + ORIENTATION_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await orientationHolds("portrait")) {
      return confirmOrientation(fallback);
    }
    await delay(ORIENTATION_POLL_MS);
  }
  return await orientationHolds("portrait");
}

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();

  return {
    get: () => value,
    set: (next: T) => {
      if (Object.is(value, next)) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Hosted in the root layout so it outlives the play route during the pop. */
const exitCoverStore = createStore(false);

export const subscribePlayOrientationExitCover = exitCoverStore.subscribe;
export const getPlayOrientationExitCoverSnapshot = exitCoverStore.get;

/**
 * NativeTabs keeps the landscape layout it was mounted with, and native-stack
 * has no option to detach inactive screens — so remount the tab tree instead.
 */
const tabsRemountStore = createStore(0);

export function useTabsRemountKey(): number {
  return useSyncExternalStore(tabsRemountStore.subscribe, tabsRemountStore.get, () => 0);
}

function remountTabs() {
  tabsRemountStore.set(tabsRemountStore.get() + 1);
}

/**
 * Play orientation, driven only by `expo-screen-orientation`. Stack
 * `orientation` is deliberately unused: with react-native-screens / Dev Client
 * on iOS it updates the allowed mask without reliably rotating.
 */
export function usePlayScreenOrientation() {
  const navigation = useNavigation();
  const [rotationSettled, setRotationSettled] = useState(Platform.OS === "web");
  /**
   * The device rotates before the render tree resizes: iOS pushes new window
   * metrics as the rotation animation starts, while the root view keeps its
   * portrait frame until the animation commits. Unblocking on `Dimensions`
   * therefore still reveals one portrait-width frame — content squeezed into a
   * strip with the rest of the screen black. The stage's own layout pass is the
   * only signal that reports the size we are actually rendering at.
   */
  const [awaitStageLandscape, setAwaitStageLandscape] = useState(false);
  const [stageLandscape, setStageLandscape] = useState(false);
  const [exiting, setExiting] = useState(false);
  const allowLeaveRef = useRef(Platform.OS === "web");
  const exitInFlightRef = useRef(false);
  /** Only a real rotation leaves the tabs below with a stale layout. */
  const rotatedRef = useRef(false);

  const onStageLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setStageLandscape(width > height);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      let layoutFallback: ReturnType<typeof setTimeout> | undefined;
      // The portrait restore cancels the landscape attempt at the source, so this
      // only guards state we would otherwise set for a screen that is leaving.
      const isActive = () => active && !exitInFlightRef.current;

      allowLeaveRef.current = Platform.OS === "web";
      exitInFlightRef.current = false;
      rotatedRef.current = false;
      setExiting(false);
      setRotationSettled(Platform.OS === "web");
      setAwaitStageLandscape(false);
      // `stageLandscape` is a standing fact about the root view, not per-focus
      // state — clearing it would strand the gate when layout never changes.
      exitCoverStore.set(false);

      void (async () => {
        if (Platform.OS === "web") return;
        const rotated = await applyOrientation("landscape", "play landscape");
        if (rotated) rotatedRef.current = true;
        if (!isActive()) return;
        // Only hold for the layout pass when a rotation actually happened —
        // with rotation disabled (Simulator) it would never report landscape.
        setAwaitStageLandscape(rotated);
        setRotationSettled(true);
        if (rotated) {
          layoutFallback = setTimeout(
            () => setAwaitStageLandscape(false),
            ORIENTATION_WAIT_TIMEOUT_MS
          );
        }
      })();

      return () => {
        active = false;
        if (layoutFallback) clearTimeout(layoutFallback);
        setRotationSettled(false);
        setAwaitStageLandscape(false);
        // Portrait restore on exit is owned by usePreventRemove. Restoring here
        // on every blur fired during stack enter transitions on release iOS and
        // cancelled the in-flight landscape lock — the same landscape → portrait
        // → landscape bounce users saw in store builds.
      };
    }, [])
  );

  usePreventRemove(Platform.OS !== "web", ({ data }) => {
    if (exitInFlightRef.current) return;
    exitInFlightRef.current = true;
    setExiting(true);
    exitCoverStore.set(true);
    // Read before the restore: leaving mid-rotation still leaves stale tabs.
    const rotated = rotatedRef.current || !windowMatches("portrait");

    void (async () => {
      try {
        const restored = await restorePortraitForExit("play exit portrait");
        if (!restored) {
          console.warn("[orientation] portrait restore incomplete before play exit pop");
        }
        navigation.setOptions({ animation: "none" });
        allowLeaveRef.current = true;
        navigation.dispatch(data.action);

        if (rotated) {
          remountTabs();
          await delay(POST_REMOUNT_SETTLE_MS);
        }
        await nextFrames(2);
      } finally {
        allowLeaveRef.current = true;
        exitInFlightRef.current = false;
        exitCoverStore.set(false);
      }
    })();
  });

  const landscapeReady = rotationSettled && (!awaitStageLandscape || stageLandscape);

  return { landscapeReady, exiting, onStageLayout };
}

/** App shell default — portrait everywhere except play. */
export async function lockAppPortrait(): Promise<void> {
  await applyOrientation("portrait", "initial portrait lock");
}

/**
 * Portrait screens call this once on focus. Play restores on exit, but a restore
 * is a request to the OS, not a guarantee — and stack screens like IP detail
 * stay mounted under play and inherit whatever geometry the window had when the
 * pop landed. One read-then-lock on focus closes that gap without the global
 * Dimensions listener that re-locked on every Alert relayout.
 */
export function usePortraitOnFocus(): void {
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === "web") return;
      void lockAppPortrait();
    }, [])
  );
}
