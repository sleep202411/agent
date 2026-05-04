import { redirect } from "next/navigation";

/**
 * `/projects` (no id) has no real page in this app — the per-project
 * workspace lives at `/projects/[id]` and the listing surface is
 * `/art-studio`. Anyone landing here (manual URL entry, broken link,
 * code that constructed the URL without an id, browser auto-reload
 * after a crash) gets bounced to art-studio so they see something
 * useful instead of a bare not-found page.
 */
export default function ProjectsIndex() {
  redirect("/art-studio");
}
