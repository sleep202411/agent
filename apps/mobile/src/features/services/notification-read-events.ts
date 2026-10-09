// Read receipts can outlive the screen that opened a notification. Notify the
// currently mounted list, without retaining account data or replaying writes.
const listeners = new Set<(generation: number) => void>();

export function notificationReadConfirmed(generation: number) {
  for (const listener of listeners) listener(generation);
}

export function subscribeNotificationReads(listener: (generation: number) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
