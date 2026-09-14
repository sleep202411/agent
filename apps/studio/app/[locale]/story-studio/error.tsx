"use client";

import { useEffect } from "react";
import { useAuth } from "@/app/_components/auth-provider";
import { storyProjectAccessFailure } from "./_components/story-project-access-error";
import { StoryProjectLoadState } from "./_components/story-project-load-state";

export default function StoryStudioError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { signIn } = useAuth();
  const accessFailure = storyProjectAccessFailure(error);

  useEffect(() => {
    if (!accessFailure) console.error(error);
  }, [accessFailure, error]);

  return (
    <StoryProjectLoadState kind={accessFailure ?? "unexpected"} onRetry={reset} onSignIn={signIn} />
  );
}
