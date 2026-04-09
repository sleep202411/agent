import { createFileRoute } from "@tanstack/react-router";
import RegisterPage from "@/app/[locale]/(auth)/register/page";

export const Route = createFileRoute("/_auth/register")({
  component: RegisterPage,
});
