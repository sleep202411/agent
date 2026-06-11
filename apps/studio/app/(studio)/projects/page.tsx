import type { Metadata } from "next";
import { ProjectsEmptyState } from "./_components/empty-state";

export const metadata: Metadata = {
  title: "Projects · FizzStudio",
};

export default function ProjectsPage() {
  return (
    <main className="mx-auto w-full max-w-[1480px] px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold">Projects</h1>
      <p className="mt-1 text-sm text-muted-foreground">Organize your generations into projects.</p>

      <ProjectsEmptyState />
    </main>
  );
}
