import { createFileRoute } from "@tanstack/react-router";
import ForgotPasswordPage from "@/app/[locale]/(auth)/forgot-password/page";

export const Route = createFileRoute("/$locale/_auth/forgot-password")({
  component: ForgotPasswordPage,
});
