"use client";

import { IconGripVertical, IconPencil, IconTrash } from "@tabler/icons-react";
import { useSortable } from "@dnd-kit/react/sortable";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { FAQ } from "@/app/(site)/ips/_hooks/use-ip";

interface SortableFaqRowProps {
  id: string;
  index: number;
  faq: FAQ;
  onEdit: () => void;
  onDelete: () => void;
}

export function SortableFaqRow({ id, index, faq, onEdit, onDelete }: SortableFaqRowProps) {
  const { ref, handleRef, isDragging } = useSortable({ id, index });

  return (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border border-border bg-card transition-colors hover:border-primary/30",
        isDragging && "opacity-50 shadow-lg"
      )}
    >
      <div className="flex items-start gap-2 p-4">
        <div
          ref={handleRef}
          className="mt-0.5 flex shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/50 transition-colors hover:text-muted-foreground active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
        >
          <IconGripVertical className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{faq.question}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-secondary-foreground">
            {faq.answer}
          </p>
        </div>
        <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon-xs" onClick={onEdit}>
            <IconPencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
            onClick={onDelete}
          >
            <IconTrash className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
