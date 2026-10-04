import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { defaultLocale, isValidLocale } from "@/src/i18n/config";

/** Feedback is read and answered from the task itself. */
export default async function MyTaskFeedbackPage() {
  const header = (await headers()).get("x-locale");
  const locale = header && isValidLocale(header) ? header : defaultLocale;
  redirect(`/${locale}/crews/tasks`);
}
