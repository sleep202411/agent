/** No provider messages or redirect parameters are completion evidence. */
export type EnrollmentFrameProps = {
  uri: string;
  characterId: string;
  callbackOrigin: string;
  title: string;
  onComplete: () => void;
  onError: () => void;
};
export function isEnrollmentCallback(value: string, characterId: string, origin: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.origin === origin &&
      [
        `/characters/${characterId}`,
        ...["en-US", "zh-CN", "zh-HK"].map((l) => `/${l}/characters/${characterId}`),
      ].includes(url.pathname.replace(/\/$/, "")) &&
      url.searchParams.get("enrollment") === "callback"
    );
  } catch {
    return false;
  }
}
export function allowEnrollmentNavigation(value: string, initialUri: string) {
  try {
    const url = new URL(value),
      initial = new URL(initialUri);
    return (
      url.protocol === "https:" && !url.username && !url.password && url.origin === initial.origin
    );
  } catch {
    return false;
  }
}
