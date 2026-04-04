"use client";

import { cn } from "@/lib/utils";
import { IconCheck } from "@tabler/icons-react";
import type { AgentStep, StepStatus } from "@/src/store/slices/agentSlice";

const steps: { step: AgentStep; label: string }[] = [
  { step: 1, label: "故事大纲" },
  { step: 2, label: "角色与场景" },
  { step: 3, label: "分集视频" },
];

interface AgentStepperProps {
  currentStep: AgentStep;
  stepStatuses: Record<AgentStep, StepStatus>;
  onStepClick?: (step: AgentStep) => void;
}

export function AgentStepper({ currentStep, stepStatuses, onStepClick }: AgentStepperProps) {
  return (
    <div className="flex items-center gap-1">
      {steps.map(({ step, label }, index) => {
        const status = stepStatuses[step];
        const isCurrent = step === currentStep;
        const isDone = status === "done";
        const canClick = isDone || isCurrent;

        return (
          <div key={step} className="flex items-center gap-1">
            {/* Step indicator */}
            <button
              type="button"
              disabled={!canClick}
              onClick={() => canClick && onStepClick?.(step)}
              className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                isCurrent && "bg-primary text-primary-foreground",
                isDone && !isCurrent && "bg-primary/10 text-primary hover:bg-primary/20",
                !isDone && !isCurrent && "text-muted-foreground cursor-default"
              )}
            >
              {isDone && !isCurrent ? (
                <IconCheck className="size-4" />
              ) : (
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-xs font-bold",
                    isCurrent && "bg-primary-foreground/20",
                    !isCurrent && !isDone && "bg-muted"
                  )}
                >
                  {step}
                </span>
              )}
              <span>{label}</span>
            </button>

            {/* Connector line */}
            {index < steps.length - 1 && (
              <div className={cn("h-px w-8", isDone ? "bg-primary/40" : "bg-border")} />
            )}
          </div>
        );
      })}
    </div>
  );
}
