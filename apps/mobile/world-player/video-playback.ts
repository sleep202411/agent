/** Keep the embedded stream held with its host; unlock only inside a real video-document tap. */
export function attachWorldVideoPlayback(
  video: HTMLVideoElement,
  button: HTMLButtonElement,
  onBlocked: (blocked: boolean) => void,
  onError: (error: unknown) => void
) {
  let active = false,
    streaming = false,
    disposed = false,
    blocked = false;
  let revision = 0;
  let pending: Promise<void> | undefined;
  const allowed = () => !disposed && active && streaming && !document.hidden;
  const paint = () => {
    button.hidden = !allowed() || !blocked;
  };
  const setBlocked = (value: boolean) => {
    if (blocked !== value) {
      blocked = value;
      onBlocked(value);
    }
    paint();
  };
  const hold = () => {
    if (!video.paused) video.pause();
    paint();
  };
  const play = () => {
    if (!allowed() || pending || video.readyState < 2) return;
    // Call synchronously: the click handler must retain transient user activation.
    const attemptRevision = revision;
    let result: Promise<void>;
    try {
      result = video.play();
    } catch (error) {
      result = Promise.reject(error);
    }
    pending = Promise.resolve(result)
      .then(
        () => {
          if (!allowed()) hold();
          else setBlocked(video.paused);
        },
        (error: unknown) => {
          if (!allowed() || attemptRevision !== revision) return;
          if (
            typeof error === "object" &&
            error !== null &&
            "name" in error &&
            error.name === "NotAllowedError"
          )
            setBlocked(true);
          else onError(error);
        }
      )
      .finally(() => {
        pending = undefined;
        if (allowed() && attemptRevision !== revision && video.paused) setBlocked(true);
      });
  };
  const ready = () => {
    if (!blocked) play();
  };
  const playing = () => {
    if (!allowed()) hold();
    else setBlocked(false);
  };
  const paused = () => {
    if (allowed() && video.readyState >= 2) setBlocked(true);
  };
  const visibility = () => {
    revision++;
    if (!allowed()) hold();
    else if (!blocked) play();
    else paint();
  };
  button.hidden = true;
  button.addEventListener("click", play);
  video.addEventListener("loadeddata", ready);
  video.addEventListener("canplay", ready);
  video.addEventListener("play", playing);
  video.addEventListener("pause", paused);
  document.addEventListener("visibilitychange", visibility);
  return {
    setActive(value: boolean) {
      if (active !== value) revision++;
      active = value;
      if (!allowed()) hold();
      else if (!blocked) play();
      else paint();
    },
    setStreaming(value: boolean) {
      if (streaming !== value) revision++;
      streaming = value;
      if (!allowed()) hold();
      else if (!blocked) play();
      else paint();
    },
    dispose() {
      disposed = true;
      hold();
      button.removeEventListener("click", play);
      video.removeEventListener("loadeddata", ready);
      video.removeEventListener("canplay", ready);
      video.removeEventListener("play", playing);
      video.removeEventListener("pause", paused);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
