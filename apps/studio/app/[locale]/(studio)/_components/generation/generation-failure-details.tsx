"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { FeedJob } from "./use-generation-feed";

export function GenerationFailureDetails({
  job,
}: {
  job: Pick<FeedJob, "jobId" | "modelId" | "error" | "errorCode">;
}) {
  const t = useTranslations("generation");
  const message = job.error?.trim() || t("generationFailed");
  const fields = [
    { label: t("failureDetails.taskId"), value: job.jobId },
    { label: t("failureDetails.model"), value: job.modelId },
    ...(job.errorCode ? [{ label: t("failureDetails.code"), value: job.errorCode }] : []),
  ];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        [message, ...fields.map(({ label, value }) => `${label}: ${value}`)].join("\n")
      );
      toast.success(t("failureDetails.copied"));
    } catch {
      toast.error(t("failureDetails.copyFailed"));
    }
  };
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
          {t("failureDetails.open")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("failureDetails.title")}</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap break-words text-left">
            {message}
          </DialogDescription>
        </DialogHeader>
        <dl className="space-y-3 text-xs">
          {fields.map(({ label, value }) => (
            <div key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="mt-1 select-text break-all">{value}</dd>
            </div>
          ))}
        </dl>
        <Button variant="secondary" onClick={copy}>
          {t("failureDetails.copy")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
