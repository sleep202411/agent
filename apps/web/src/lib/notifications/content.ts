import type { NotificationDTO } from "@repo/shared/notifications";
import type { Locale } from "@/src/i18n/config";

type Translate = (key: string, params?: Record<string, string | number | Date>) => string;

export interface NotificationContent {
  title: string;
  body: string;
}

/**
 * Render semantic notification events in the reader's active locale.
 *
 * The server deliberately persists an English title/body as a durable,
 * forwards-compatible fallback. New producers also persist semantic metadata,
 * which lets the web render the same business event in any supported locale
 * without mutating historical rows or coupling backend jobs to UI language.
 */
export function notificationContent(
  item: NotificationDTO,
  locale: Locale,
  t: Translate,
  actorName?: string | null
): NotificationContent {
  const fallback = { title: item.title, body: item.body };
  const crewName = metaString(item, "crewName");
  const positionType = metaString(item, "positionType");
  const position = metaString(item, "positionTitle") ?? metaString(item, "positionCategoryKey");
  const agreementTitle = metaString(item, "agreementTitle");
  const taskTitle = metaString(item, "taskTitle");

  switch (item.type) {
    case "crew.application.submitted":
      return positionType && crewName
        ? {
            title: t("events.applicationSubmitted.title", { position: positionType }),
            body: t("events.applicationSubmitted.body", { crew: crewName }),
          }
        : fallback;
    case "crew.application.approved":
      return crewName && positionType
        ? {
            title: t("events.applicationApproved.title"),
            body: t("events.applicationApproved.body", {
              crew: crewName,
              role: positionType,
            }),
          }
        : fallback;
    case "crew.application.rejected":
      return crewName
        ? {
            title: t("events.applicationRejected.title"),
            body: t("events.applicationRejected.body", { crew: crewName }),
          }
        : fallback;
    case "crew.member.removed":
      return crewName
        ? {
            title: t("events.memberRemoved.title", { crew: crewName }),
            body: t("events.memberRemoved.body"),
          }
        : fallback;
    case "crew.invitation.received":
      return crewName && position
        ? {
            title: t("events.invitationReceived.title", { crew: crewName }),
            body: t("events.invitationReceived.body", { role: position }),
          }
        : fallback;
    case "crew.invitation.accepted":
      return crewName
        ? {
            title: t("events.invitationAccepted.title"),
            body: t("events.invitationAccepted.body", { crew: crewName }),
          }
        : fallback;
    case "crew.agreement.sent":
      return agreementTitle
        ? {
            title: agreementTitle,
            body: t("events.agreementSent.body"),
          }
        : fallback;
    case "crew.agreement.updated": {
      const status = metaString(item, "status");
      if (!agreementTitle || !isAgreementStatus(status)) return fallback;
      return {
        title: agreementTitle,
        body: t(`events.agreementStatus.${status}`),
      };
    }
    case "crew.chat.mentioned":
      return {
        title: t("events.chatMentioned.title"),
        body: item.body,
      };
    case "crew.task.assigned":
      return taskTitle
        ? {
            title: t("events.taskAssigned.title", { task: taskTitle }),
            body: actorName?.trim()
              ? t("events.taskAssigned.bodyWithActor", { actor: actorName.trim() })
              : t("events.taskAssigned.body"),
          }
        : fallback;
    case "crew.task.updated":
      return taskTitle
        ? {
            title: t("events.taskUpdated.title", { task: taskTitle }),
            body: actorName?.trim()
              ? t("events.taskUpdated.bodyWithActor", { actor: actorName.trim() })
              : t("events.taskUpdated.body"),
          }
        : fallback;
    case "crew.task.commented":
      return taskTitle
        ? {
            title: t("events.taskCommented.title", { task: taskTitle }),
            body:
              metaString(item, "commentBody") ??
              (metaBoolean(item, "hasAttachments")
                ? t("events.taskCommented.attachmentBody")
                : item.body),
          }
        : fallback;
    case "crew.task.mentioned":
      return taskTitle
        ? {
            title: t("events.taskMentioned.title", { task: taskTitle }),
            body:
              metaString(item, "commentBody") ??
              (metaBoolean(item, "hasAttachments")
                ? t("events.taskMentioned.attachmentBody")
                : item.body),
          }
        : fallback;
    case "crew.task.submitted": {
      const version = metaNumber(item, "submissionVersion");
      return taskTitle && version != null
        ? {
            title: t("events.taskSubmitted.title", { task: taskTitle }),
            body: t("events.taskSubmitted.body", { version }),
          }
        : fallback;
    }
    case "crew.task.approved":
      return taskTitle
        ? {
            title: t("events.taskApproved.title", { task: taskTitle }),
            body: metaString(item, "reviewNote") ?? t("events.taskApproved.body"),
          }
        : fallback;
    case "crew.task.revision_requested":
      return taskTitle
        ? {
            title: t("events.taskRevisionRequested.title", { task: taskTitle }),
            body: metaString(item, "reviewNote") ?? t("events.taskRevisionRequested.body"),
          }
        : fallback;
    case "crew.earning.posted":
    case "crew.earning.rejected":
    case "crew.earning.reversed": {
      const earningTitle = metaString(item, "earningTitle");
      const unit = metaString(item, "currency");
      const grossAmount = formatMinorCurrency(metaString(item, "amountMinor"), unit, locale);
      if (!earningTitle || !grossAmount) return fallback;
      const outcome = item.type.slice("crew.earning.".length) as "posted" | "rejected" | "reversed";
      return {
        title: t(`events.earning.${outcome}.title`, { title: earningTitle }),
        body: t(`events.earning.${outcome}.body`, { amount: grossAmount }),
      };
    }
    case "crew.withdrawal.processing":
    case "crew.withdrawal.paid":
    case "crew.withdrawal.rejected": {
      const outcome = item.type.slice("crew.withdrawal.".length) as
        | "processing"
        | "paid"
        | "rejected";
      return {
        title: t(`events.withdrawal.${outcome}.title`),
        body: t(`events.withdrawal.${outcome}.body`),
      };
    }
    case "crew.payout.scheduled":
    case "crew.payout.paid":
    case "crew.payout.voided": {
      const unit = metaString(item, "currency");
      const grossAmount = formatMinorCurrency(metaString(item, "amountMinor"), unit, locale);
      const amount = formatMinorCurrency(
        metaString(item, "netAmountMinor"),
        metaString(item, "currency"),
        locale
      );
      if (!grossAmount || !amount) return fallback;
      const outcome = item.type.slice("crew.payout.".length) as "scheduled" | "paid" | "voided";
      return {
        title: t(`events.payout.${outcome}.title`),
        body: t(`events.payout.${outcome}.body`, { grossAmount, amount }),
      };
    }
    default:
      return fallback;
  }
}

function metaString(item: NotificationDTO, key: string): string | null {
  const value = item.meta?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function metaNumber(item: NotificationDTO, key: string): number | null {
  const value = item.meta?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metaBoolean(item: NotificationDTO, key: string): boolean {
  return item.meta?.[key] === true;
}

function isAgreementStatus(
  value: string | null
): value is "draft" | "sending" | "sent" | "signed" | "declined" | "expired" | "failed" | "voided" {
  return (
    value === "draft" ||
    value === "sending" ||
    value === "sent" ||
    value === "signed" ||
    value === "declined" ||
    value === "expired" ||
    value === "failed" ||
    value === "voided"
  );
}

function formatMinorCurrency(
  amountMinor: string | null,
  currency: string | null,
  locale: Locale
): string | null {
  if (!amountMinor || !currency || !/^-?\d+$/.test(amountMinor)) return null;
  try {
    const amount = BigInt(amountMinor);
    if (amount > BigInt(Number.MAX_SAFE_INTEGER) || amount < BigInt(Number.MIN_SAFE_INTEGER)) {
      const sign = amount < 0n ? "-" : "";
      const absolute = amount < 0n ? -amount : amount;
      const major = absolute / 100n;
      const minor = (absolute % 100n).toString().padStart(2, "0");
      return `${sign}${currency} ${major.toLocaleString(locale)}.${minor}`;
    }
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(Number(amount) / 100);
  } catch {
    return null;
  }
}
