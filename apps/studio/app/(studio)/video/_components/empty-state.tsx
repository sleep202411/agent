"use client";

import { IconPlus, IconVideo } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function VideoEmptyState() {
  return (
    <div className="mt-6 flex flex-col items-center rounded-xl bg-card px-6 py-24 text-center">
      <div className="flex size-20 items-center justify-center rounded-full bg-muted">
        <IconVideo className="size-10 text-white/25" stroke={1.5} />
      </div>
      <p className="mt-6 text-sm font-medium">No generations yet</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Videos you generate will appear here. Start your first one to build your library.
      </p>
      <Button
        size="lg"
        className="mt-6"
        onClick={() => toast.info("Video generation · Coming soon")}
      >
        <IconPlus data-icon="inline-start" />
        New generation
      </Button>
    </div>
  );
}
