let revision = 0;
const listeners = new Set<() => void>();
export const getWorkRevision = () => revision;
export const subscribeWorks = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function refreshPersonalWorks() {
  revision += 1;
  for (const listener of listeners) listener();
}
