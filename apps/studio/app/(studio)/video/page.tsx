import type { Metadata } from "next";
import { VideoEmptyState } from "./_components/empty-state";

export const metadata: Metadata = {
  title: "Video · FizzStudio",
};

export default function VideoPage() {
  return (
    <main className="mx-auto w-full max-w-[1480px] px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold">Video</h1>
      <p className="mt-1 text-sm text-muted-foreground">Generate videos with AI models.</p>

      <VideoEmptyState />
    </main>
  );
}
