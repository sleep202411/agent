import { Suspense } from "react";
import { StoryProjectChapterScope } from "@/app/[locale]/story-studio/_components/story-project-chapter-scope";
import { StoryProjectShell } from "@/app/[locale]/story-studio/_components/story-project-shell";

/**
 * Project scope stays mounted across every project route. StoryProjectShell
 * chooses normal production chrome or the dedicated full-screen editor shell.
 */
export default async function StoryProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <Suspense fallback={null}>
      <StoryProjectChapterScope projectId={projectId}>
        <StoryProjectShell projectId={projectId}>{children}</StoryProjectShell>
      </StoryProjectChapterScope>
    </Suspense>
  );
}
