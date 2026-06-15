import { redirect } from "next/navigation";

/** /settings lands on the active workspace's Overview (the reference default). */
export default function SettingsIndexPage() {
  redirect("/settings/overview");
}
