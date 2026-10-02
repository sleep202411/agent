"use client";
import { useEffect, useRef, useState } from "react";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/src/i18n/i18n";
import { crewApi } from "../../../../_hooks/api";
import type { CrewDTO } from "../../../../_hooks/types";

/** Explicit imports keep public recruitment copy under the creator's control. */
export function TaskCrewContext({
  crewId,
  members,
  onImport,
}: {
  crewId: string;
  members: { id: string; name: string }[];
  onImport: (text: string) => void;
}) {
  const t = useTranslations("crewTaskContext");
  const [member, setMember] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), [crewId]);
  async function loadIntroduction() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const crew = await crewApi.get<CrewDTO>(`/crews/${encodeURIComponent(crewId)}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!controller.signal.aborted) {
        if (!crew.description?.trim()) setError(t("empty"));
        else onImport(`${t("introduction")}\n${crew.description.trim()}`);
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="space-y-2">
        <p className="block text-sm font-medium">{t("creator")}</p>
        <div className="flex gap-2">
          <NativeSelect
            aria-label={t("creator")}
            className="min-w-0 flex-1 rounded-md border border-white/15 bg-[#121212] p-3 text-sm"
            value={member}
            onChange={setMember}
          >
            <option value="">{t("select")}</option>
            {members.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </NativeSelect>
          <Button
            variant="outline"
            disabled={!members.some((item) => item.id === member)}
            onClick={() => {
              const chosen = members.find((item) => item.id === member);
              if (chosen) onImport(`${t("creator")}: ${chosen.name}`);
            }}
          >
            {t("import")}
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">{t("introduction")}</p>
        <Button
          className="w-full"
          variant="outline"
          disabled={busy}
          onClick={() => void loadIntroduction()}
        >
          {t("load")}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
