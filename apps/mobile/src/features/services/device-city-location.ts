import {
  Accuracy,
  getCurrentPositionAsync,
  requestForegroundPermissionsAsync,
} from "expo-location";
export async function locateDeviceCity(
  signal: AbortSignal,
  message: (
    key:
      | "creatorDeviceCity.unavailable"
      | "creatorDeviceCity.denied"
      | "creatorDeviceCity.unsupported"
  ) => string
) {
  const current = () => {
    if (signal.aborted) throw Error(message("creatorDeviceCity.unavailable"));
  };
  current();
  const permission = await requestForegroundPermissionsAsync();
  current();
  if (!permission.granted) throw Error(message("creatorDeviceCity.denied"));
  return new Promise<{ latitude: number; longitude: number }>((resolve, reject) => {
    const finish = (error?: Error, coords?: { latitude: number; longitude: number }) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(coords!);
    };
    const abort = () => finish(Error(message("creatorDeviceCity.unavailable")));
    const timer = setTimeout(abort, 10000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    void getCurrentPositionAsync({ accuracy: Accuracy.Balanced }).then(
      (position) => {
        if (signal.aborted) abort();
        else
          finish(undefined, {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
      },
      () => finish(Error(message("creatorDeviceCity.unavailable")))
    );
  });
}
