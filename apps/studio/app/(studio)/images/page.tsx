import type { Metadata } from "next";
import { WorkspaceRemount } from "@/app/_components/workspace-remount";
import { ImageStudio } from "./_components/image-studio";

export const metadata: Metadata = {
  title: "Image · FizzStudio",
};

export default function ImagesPage() {
  return (
    <main className="mx-auto w-full max-w-[1480px] px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold">Image</h1>
      <p className="mt-1 text-sm text-muted-foreground">Generate images with AI models.</p>

      <WorkspaceRemount>
        <ImageStudio />
      </WorkspaceRemount>
    </main>
  );
}
