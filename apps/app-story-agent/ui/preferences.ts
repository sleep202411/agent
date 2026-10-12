import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import { useSyncExternalStore } from "react";
import { presentationLocale, type StoryContext, type StoryTransport } from "./transport";
import type {
  ConfigForm,
  ConfigFormSnapshot,
  ConfigForms,
} from "@deepseek-ai/dsh-client-ui-settings/client";
import type { SettingsPathOpView } from "@deepseek-ai/dsh-api-remotes/client";

/** Browser presentation preferences only. No model, credential or developer settings are served. */
export function storyPreferences(projectId: string, locale: StoryContext["locale"]) {
  const defaults: Record<string, Record<string, unknown>> = {
    locale: { preference: locale },
    "ui-theme": { preference: "dark", fontSize: 14 },
    "ui-chat": { transcriptView: "compact", performanceUsage: "detailed", linkOpening: "new-tab" },
    "ui-conversation": { busyEnter: "queue" },
  };
  const valid = (namespace: string, value: Record<string, unknown>) => {
    if (namespace === "locale")
      return ["en", "zh", "en-US", "zh-CN", "zh-HK"].includes(String(value.preference));
    if (namespace === "ui-theme")
      return (
        ["dark", "light", "system"].includes(String(value.preference)) &&
        Number.isInteger(value.fontSize) &&
        Number(value.fontSize) >= 10 &&
        Number(value.fontSize) <= 22
      );
    if (namespace === "ui-chat")
      return (
        ["compact", "standard", "detailed", "verbose", "normal", "expanded"].includes(
          String(value.transcriptView)
        ) &&
        ["compact", "detailed"].includes(String(value.performanceUsage)) &&
        ["sidebar", "new-tab"].includes(String(value.linkOpening))
      );
    if (namespace === "ui-conversation")
      return ["queue", "steer"].includes(String(value.busyEnter));
    return false;
  };
  const forms = new Map<string, ConfigForm<unknown>>();
  const describe = createSnapshotStore({
    status: "ready" as const,
    view: { namespaces: [], writable: false, hasDocument: false },
    error: null,
  });
  return {
    get<T>(namespace: string): ConfigForm<T> {
      if (!forms.has(namespace)) {
        const base = defaults[namespace] ?? {};
        const storageKey =
          namespace === "locale" ? "story-ui:locale" : `story-ui:${projectId}:${namespace}`;
        let user: Record<string, unknown> = {};
        try {
          const value = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
          if (value && typeof value === "object" && !Array.isArray(value))
            user = Object.fromEntries(
              Object.entries(value).filter(([key]) => Object.hasOwn(base, key))
            );
          if (!valid(namespace, { ...base, ...user })) user = {};
        } catch {
          /* Defaults survive unavailable browser storage. */
        }
        const state = createSnapshotStore<ConfigFormSnapshot<unknown>>({
          status: "ready",
          value: { ...base, ...user },
          base,
          user,
          revision: 0,
          writable: true,
          mode: "memory",
        });
        const mutate = async (ops: readonly SettingsPathOpView[]) => {
          const next = { ...user };
          for (const op of ops) {
            if (op.path.length !== 1 || !Object.hasOwn(base, op.path[0])) return false;
            if (op.op === "set") next[op.path[0]] = op.value;
            else delete next[op.path[0]];
          }
          const value = { ...base, ...next };
          if (!valid(namespace, value)) return false;
          if (namespace === "locale" && next.preference !== undefined) {
            next.preference = presentationLocale(String(next.preference));
            value.preference = next.preference;
          }
          user = next;
          try {
            localStorage.setItem(storageKey, JSON.stringify(user));
          } catch {
            /* Preference stays live for this page. */
          }
          state.set({
            ...state.getSnapshot(),
            value,
            user,
            revision: state.getSnapshot().revision! + 1,
          });
          return true;
        };
        forms.set(namespace, {
          ...state,
          mutate,
          set: (field, value) =>
            mutate([
              {
                op: "set",
                path: [field],
                value: value as import("@deepseek-ai/dsh-util-values").JsonValue,
              },
            ]),
          unset: (field) => mutate([{ op: "unset", path: [field] }]),
        });
      }
      return forms.get(namespace)! as ConfigForm<T>;
    },
    developerTools: { enabled: createSnapshotStore(false), setEnabled: async () => {} },
    describe: () => ({ ...describe, ensure: async () => {}, acceptView: () => {} }),
    whileServed: (
      namespaces: readonly string[],
      register: (served: ReadonlySet<string>) => () => void
    ) => register(new Set(namespaces.filter((namespace) => Object.hasOwn(defaults, namespace)))),
  } satisfies Pick<ConfigForms, "get" | "describe" | "whileServed"> & {
    developerTools: Pick<ConfigForms["developerTools"], "enabled" | "setEnabled">;
  };
}

/** Subscribe to Harness's language; production requests retain their admitted locale. */
export function useStoryLocale(transport: StoryTransport) {
  return useSyncExternalStore(transport.subscribeDisplayLocale, transport.getDisplayLocale);
}
