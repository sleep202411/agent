"use client";

import { useEffect, useRef } from "react";
import { useAppSelector } from "@/src/store";
import { selectCurrentInstance } from "@/src/store/slices/projectSlice";
import { ProjectParamsForm, isProjectParamsComplete } from "./project-params-form";

interface ToolRequireParamsCardProps {
  onConfirmed: () => void;
}

/**
 * Wraps `ProjectParamsForm` as a tool-card. Auto-confirms when the project
 * already has all 4 params set (user-silent pass-through), so supervisor's
 * mandatory preflight call doesn't show a redundant form.
 */
export function ToolRequireParamsCard({ onConfirmed }: ToolRequireParamsCardProps) {
  const detail = useAppSelector((s) => selectCurrentInstance(s).detail);
  const complete = isProjectParamsComplete(detail);
  const autoConfirmedRef = useRef(false);

  useEffect(() => {
    if (complete && !autoConfirmedRef.current) {
      autoConfirmedRef.current = true;
      onConfirmed();
    }
  }, [complete, onConfirmed]);

  if (complete) {
    // Rendering nothing during auto-confirm avoids a flash of the form.
    return null;
  }

  return <ProjectParamsForm onSubmitted={onConfirmed} />;
}
