import type { Metadata } from "next";
import { CanvasProjectsGrid } from "./_components/projects-grid";

export const metadata: Metadata = {
  title: "Canvas · FizzStudio",
};

export default function CanvasProjectsPage() {
  return (
    <main className="mx-auto w-full max-w-[1480px] px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold">Canvas</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Infinite boards for generating and arranging images.
      </p>
      <CanvasProjectsGrid />
    </main>
  );
}
