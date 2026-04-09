import { createFileRoute } from "@tanstack/react-router";
import LoginPage from "@/app/[locale]/(auth)/login/page";

export const Route = createFileRoute("/$locale/_auth/login")({
  component: LoginPage,
});
