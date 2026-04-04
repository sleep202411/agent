"use client";

import { Empty, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Empty>
        <EmptyTitle>Something went wrong</EmptyTitle>
        <EmptyDescription>
          {process.env.NODE_ENV === "development" ? error.message : "An unexpected error occurred."}
        </EmptyDescription>
        <Button className="mt-4" onClick={reset}>
          Try again
        </Button>
      </Empty>
    </div>
  );
}
