"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  CreatorLocationProfileSchema,
  SaveCreatorLocationProfileSchema,
  type CreatorLocationProfile,
} from "@repo/shared/creator-location";
import { api, ApiRequestError } from "@/src/lib/api";
import { useTranslations } from "@/src/i18n/i18n";

const requestSchema = SaveCreatorLocationProfileSchema;
const responseSchema = z.object({
  version: z.number().int().min(0),
  profile: CreatorLocationProfileSchema.nullable(),
  requestId: z.uuid().nullable(),
});
type Request = z.infer<typeof requestSchema>;
type Result = z.infer<typeof responseSchema>;
const emptyProfile: CreatorLocationProfile = {
  basedIn: null,
  serves: [],
  remote: false,
  showOnMap: false,
};

export function useCreatorLocationEditor(userId: string) {
  const t = useTranslations("creatorLocation");
  const path = "/aurora/creator-location/me";
  const key = `creator-location-owner:${userId}`;
  const [result, setResult] = useState<Result | null>(null);
  const [profile, setProfile] = useState<CreatorLocationProfile>(emptyProfile);
  const [pending, setPending] = useState<Request | null>(null);
  const [busy, setBusy] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const operation = useRef<AbortController | null>(null);

  function failure(cause: unknown) {
    setError(cause instanceof Error ? cause.message : String(cause));
    if (cause instanceof ApiRequestError && [401, 403, 404].includes(cause.status)) {
      setDenied(true);
      setProfile(emptyProfile);
      setResult(null);
      setPending(null);
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Access is still cleared in memory. */
      }
    }
  }
  async function load(discard = false) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const value = responseSchema.parse(await api.get(path, { signal: controller.signal }));
      if (controller.signal.aborted) return;
      const stored = sessionStorage.getItem(key);
      const recovered = !discard && stored ? requestSchema.parse(JSON.parse(stored)) : null;
      // Reconcile a lost reply, but do not confuse a different writer's newer
      // revision with acknowledgment of our request. Its retry will return 409.
      const outstanding = recovered && value.requestId !== recovered.requestId ? recovered : null;
      if (!outstanding) sessionStorage.removeItem(key);
      setPending(outstanding);
      setProfile(outstanding?.profile ?? value.profile ?? emptyProfile);
      setResult(value);
      setBlocked(false);
      setDenied(false);
    } catch (cause) {
      if (!controller.signal.aborted) failure(cause);
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      operation.current?.abort();
      operation.current = null;
    };
    // This component is keyed by account; both its storage and requests reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (operation.current || !result || blocked || denied) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError(null);
    setSaved(false);
    let request = pending;
    try {
      if (!request) {
        const parsed = CreatorLocationProfileSchema.safeParse(profile);
        if (!parsed.success) throw new Error(t("invalid"));
        request = {
          requestId: crypto.randomUUID(),
          expectedVersion: result.version,
          profile: parsed.data,
        };
        // Persist before dispatch. Failure to store must not send an unrecoverable write.
        sessionStorage.setItem(key, JSON.stringify(request));
        setPending(request);
      }
      await api.put(path, { signal: controller.signal, data: request });
      if (controller.signal.aborted) return;
      sessionStorage.removeItem(key);
      setPending(null);
      setBlocked(true);
      // A replay may acknowledge an older revision: always read the current one.
      const current = responseSchema.parse(await api.get(path, { signal: controller.signal }));
      if (controller.signal.aborted) return;
      setResult(current);
      setProfile(current.profile ?? emptyProfile);
      setBlocked(false);
      setSaved(true);
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (cause instanceof ApiRequestError && [400, 409].includes(cause.status)) {
          sessionStorage.removeItem(key);
          setPending(null);
          if (cause.status === 409) setBlocked(true);
        }
        failure(cause);
      }
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setBusy(false);
      }
    }
  }

  function change(next: CreatorLocationProfile) {
    setSaved(false);
    setProfile(next);
  }
  return {
    profile,
    change,
    result,
    pending,
    busy,
    blocked,
    denied,
    error,
    saved,
    load,
    save,
    failure,
  };
}
