"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale } from "@/src/i18n/i18n";
import { crewApi } from "../_hooks/api";
import type { CrewApplicationDTO } from "../_hooks/types";

/** Applying opens the private discussion. It never grants Crew membership. */
export function ApplyToOpening(props: {
  crewId: string;
  positionId: string;
  disabled?: boolean;
  label: string;
}) {
  const { user } = useCurrentUser();
  return (
    <ApplySession key={`${user?.id}:${props.positionId}`} {...props} signedIn={Boolean(user)} />
  );
}
function ApplySession({
  crewId,
  positionId,
  disabled,
  label,
  signedIn,
}: {
  crewId: string;
  positionId: string;
  disabled?: boolean;
  label: string;
  signedIn: boolean;
}) {
  const router = useRouter();
  const locale = useLocale();
  const auth = useAuthDialog();
  const operation = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => operation.current?.abort(), []);
  async function apply() {
    if (!signedIn) {
      auth.open();
      return;
    }
    if (disabled || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setError("");
    try {
      // Recover an existing thread (including a lost creation response) before
      // creating. The server still checks eligibility and duplicate submissions.
      const existing = await crewApi.get<{ items: CrewApplicationDTO[] }>("/me/crew-applications", {
        signal: controller.signal,
        cache: "no-store",
        query: { positionId, status: "pending", limit: 1 },
      });
      const application =
        existing.items[0] ??
        (await crewApi.post<CrewApplicationDTO>(
          `/crews/${encodeURIComponent(crewId)}/positions/${encodeURIComponent(positionId)}/apply`,
          { body: {}, signal: controller.signal }
        ));
      if (!controller.signal.aborted)
        router.push(
          `/${locale}/messages?tab=recruitment&application=${encodeURIComponent(application.id)}`
        );
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!controller.signal.aborted) {
        operation.current = null;
        setPending(false);
      }
    }
  }
  return (
    <div className="space-y-2">
      <Button disabled={disabled || pending} loading={pending} onClick={() => void apply()}>
        {label}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
