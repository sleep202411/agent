export function locateDeviceCity(
  signal: AbortSignal,
  message: (
    key:
      | "creatorDeviceCity.unavailable"
      | "creatorDeviceCity.denied"
      | "creatorDeviceCity.unsupported"
  ) => string
) {
  return new Promise<{ latitude: number; longitude: number }>((resolve, reject) => {
    if (!globalThis.isSecureContext || !navigator.geolocation) {
      reject(Error(message("creatorDeviceCity.unsupported")));
      return;
    }
    const abort = () => reject(Error(message("creatorDeviceCity.unavailable")));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) abort();
        else resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      },
      (failure) => {
        signal.removeEventListener("abort", abort);
        reject(
          Error(
            message(
              failure.code === 1 ? "creatorDeviceCity.denied" : "creatorDeviceCity.unavailable"
            )
          )
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }
    );
  });
}
