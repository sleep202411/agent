"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { useCrewDetail } from "../_hooks/use-crew-detail";
import { useInitialCaseEvidence } from "../_hooks/use-initial-case-evidence";
import { usePrivateCaseWrite } from "../_hooks/use-private-case-write";
import type { CrewTaskDTO } from "../_hooks/types";

export function TaskDisputeControl({
  task,
  initiallyOpen = false,
}: {
  task: CrewTaskDTO;
  initiallyOpen?: boolean;
}) {
  const { user, isLoading } = useCurrentUser();
  if (!user || isLoading) return null;
  return (
    <DisputeSession
      key={JSON.stringify([user.id, task.id])}
      task={task}
      userId={user.id}
      initiallyOpen={initiallyOpen}
    />
  );
}
function DisputeSession({
  task,
  userId,
  initiallyOpen,
}: {
  task: CrewTaskDTO;
  userId: string;
  initiallyOpen: boolean;
}) {
  const t = useTranslations("crewTaskDispute"),
    casesT = useTranslations("crewCases"),
    locale = useLocale();
  const evidenceT = useTranslations("crewEvidence");
  const [caseId] = useState(() => crypto.randomUUID());
  const crew = useCrewDetail(task.crewId);
  const client = useQueryClient();
  const [open, setOpen] = useState(initiallyOpen);
  const [respondent, setRespondent] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("");
  const [desiredResolution, setDesiredResolution] = useState("");
  const [evidence, setEvidence] = useState<string[]>([]);
  const mutation = usePrivateCaseWrite<{ id: string }>(
    async () => client.invalidateQueries({ queryKey: ["crew-cases", userId] }),
    casesT("failed")
  );
  const readable = crew.isSuccess && !crew.isError && crew.data?.id === task.crewId;
  const participants = [
    ...new Set(
      [
        task.createdByUserId,
        task.approvedByUserId,
        readable ? crew.data?.ownerUserId : null,
        ...task.assignees.map((a) => a.userId),
        ...task.submissions.flatMap((s) => [s.submittedByUserId, s.reviewedByUserId]),
      ].filter((id): id is string => Boolean(id))
    ),
  ];
  const eligible = readable && participants.includes(userId);
  const candidates = participants.filter((id) => id !== userId);
  const disabled = mutation.busy || Boolean(mutation.retry) || Boolean(mutation.saved);
  const initialEvidence = useInitialCaseEvidence(task.id, caseId, disabled, evidenceT);
  const evidenceChanged = evidence.some((id) => !task.submissions.some((s) => s.id === id));
  const valid =
    eligible &&
    !initialEvidence.busy &&
    !initialEvidence.unresolved &&
    Boolean(category) &&
    candidates.includes(respondent) &&
    title.trim().length >= 1 &&
    title.trim().length <= 180 &&
    message.trim().length >= 1 &&
    message.trim().length <= 1000 &&
    evidence.length <= 20 &&
    evidence.every((id) => task.submissions.some((s) => s.id === id));
  return (
    <section className="space-y-3 py-3" aria-label={t("title")}>
      <Button variant="outline" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {t("title")}
      </Button>
      {open && (
        <>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
          <Link className="text-primary underline" href={`/${locale}/resolution-center`}>
            {casesT("existingCases")}
          </Link>
          {mutation.error && <p role="alert">{mutation.error}</p>}
          {mutation.saved ? (
            <div role="status">
              <p>{t("saved")}</p>
              <Link
                className="text-primary underline"
                href={`/${locale}/resolution-center/${encodeURIComponent(mutation.saved.id)}`}
              >
                {casesT("viewCase")}
              </Link>
            </div>
          ) : (
            <>
              {crew.isPending && <p>{casesT("loading")}</p>}
              {crew.isError && <p role="alert">{crew.error.message}</p>}
              {!readable && (
                <Button
                  variant="outline"
                  disabled={crew.isFetching}
                  onClick={() => void crew.refetch()}
                >
                  {t("refresh")}
                </Button>
              )}
              {readable && !eligible && <p>{t("notParticipant")}</p>}
              {eligible && (
                <fieldset className="space-y-3" disabled={disabled}>
                  <label className="block">
                    {t("respondent")} <span className="text-destructive">*</span>
                    <NativeSelect
                      aria-label={t("respondent")}
                      disabled={disabled}
                      value={respondent}
                      onChange={setRespondent}
                    >
                      <NativeSelectOption value="">{t("choose")}</NativeSelectOption>
                      {candidates.map((id) => (
                        <NativeSelectOption key={id} value={id}>
                          {id}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </label>
                  {respondent && !candidates.includes(respondent) && (
                    <p role="alert">{t("participantChanged")}</p>
                  )}
                  {!candidates.length && <p>{t("noRespondent")}</p>}
                  <label className="block">
                    {t("category")} <span className="text-destructive">*</span>
                    <NativeSelect
                      aria-label={t("category")}
                      value={category}
                      onChange={setCategory}
                      disabled={disabled}
                    >
                      <NativeSelectOption value="">{t("chooseCategory")}</NativeSelectOption>
                      {(["copyright", "payment", "violation", "harassment", "other"] as const).map(
                        (value) => (
                          <NativeSelectOption key={value} value={value}>
                            {t(`categories.${value}`)}
                          </NativeSelectOption>
                        )
                      )}
                    </NativeSelect>
                  </label>
                  <label className="block">
                    {t("subject")} <span className="text-destructive">*</span>
                    <Input
                      maxLength={180}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </label>
                  <label className="block">
                    {t("message")} <span className="text-destructive">*</span>
                    <Textarea
                      maxLength={1000}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                    />
                    <span className="block text-right text-xs text-muted-foreground">
                      {message.length} / 1000
                    </span>
                  </label>
                  <fieldset className="space-y-2">
                    <legend>{t("evidence")}</legend>
                    <p className="text-sm text-muted-foreground">{t("evidenceHelp")}</p>
                    {evidenceChanged && (
                      <div>
                        <p role="alert">{t("evidenceChanged")}</p>
                        <Button
                          variant="outline"
                          disabled={disabled}
                          onClick={() => setEvidence([])}
                        >
                          {t("clearEvidence")}
                        </Button>
                      </div>
                    )}
                    {task.submissions.map((s) => (
                      <label key={s.id} className="flex items-center gap-2">
                        <Checkbox
                          checked={evidence.includes(s.id)}
                          disabled={disabled || (!evidence.includes(s.id) && evidence.length >= 20)}
                          onCheckedChange={(checked) =>
                            setEvidence((previous) =>
                              checked === true
                                ? [...new Set([...previous, s.id])]
                                : previous.filter((id) => id !== s.id)
                            )
                          }
                        />
                        {t("submission", { version: s.versionNumber, id: s.id })}
                      </label>
                    ))}
                  </fieldset>
                  <fieldset className="space-y-2">
                    <legend>{t("initialEvidence")}</legend>
                    <p className="text-sm text-muted-foreground">{t("initialEvidenceHint")}</p>
                    <Input
                      aria-label={t("initialEvidence")}
                      type="file"
                      accept="application/pdf,image/png,image/jpeg"
                      disabled={
                        disabled ||
                        initialEvidence.busy ||
                        initialEvidence.unresolved ||
                        initialEvidence.items.length >= 5
                      }
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) initialEvidence.add(file);
                      }}
                    />
                    {initialEvidence.busy && <p role="status">{evidenceT("uploading")}</p>}
                    {initialEvidence.error && <p role="alert">{initialEvidence.error}</p>}
                    {initialEvidence.items.map((item) => (
                      <div key={item.id} className="flex flex-wrap items-center gap-2">
                        <span className="break-all">{item.file.name}</span>
                        <span>
                          {item.stage === "ready" ? t("evidenceReady") : t("evidencePending")}
                        </span>
                        {item.stage !== "ready" && !initialEvidence.busy && (
                          <>
                            <Button
                              variant="outline"
                              disabled={disabled}
                              onClick={() => initialEvidence.retry(item)}
                            >
                              {evidenceT("retry")}
                            </Button>
                            <Button
                              variant="outline"
                              disabled={disabled}
                              onClick={() => initialEvidence.retry(item, true)}
                            >
                              {evidenceT("confirmStored")}
                            </Button>
                          </>
                        )}
                        <Button
                          variant="ghost"
                          disabled={disabled || initialEvidence.busy}
                          onClick={() => initialEvidence.remove(item.id)}
                        >
                          {t("removeEvidence")}
                        </Button>
                      </div>
                    ))}
                  </fieldset>
                  <label className="block">
                    {t("desiredResolution")}
                    <NativeSelect
                      aria-label={t("desiredResolution")}
                      value={desiredResolution}
                      onChange={setDesiredResolution}
                      disabled={disabled}
                    >
                      <NativeSelectOption value="">{t("noPreference")}</NativeSelectOption>
                      {(["payment_allocation", "warning", "takedown"] as const).map((value) => (
                        <NativeSelectOption key={value} value={value}>
                          {t(`resolutions.${value}`)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </label>
                  <Button
                    disabled={disabled || !valid}
                    onClick={() => {
                      if (valid && !disabled)
                        void mutation.send({
                          path: `/crew-tasks/${encodeURIComponent(task.id)}/disputes`,
                          body: {
                            id: caseId,
                            respondentUserId: respondent,
                            title: title.trim(),
                            category,
                            ...(desiredResolution ? { desiredResolution } : {}),
                            message: message.trim(),
                            submissionIds: [...evidence],
                            ...(initialEvidence.ids.length
                              ? { attachmentIds: initialEvidence.ids }
                              : {}),
                          },
                        });
                    }}
                  >
                    {t("submit")}
                  </Button>
                </fieldset>
              )}
              {mutation.retry && (
                <div>
                  <p>{casesT("retryHelp")}</p>
                  <Button
                    disabled={mutation.busy}
                    onClick={() => void mutation.send(mutation.retry!, true)}
                  >
                    {casesT("retryWrite")}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
