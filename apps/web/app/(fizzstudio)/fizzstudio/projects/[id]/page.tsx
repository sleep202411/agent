"use client";

import { useParams } from "next/navigation";
import { ProjectWorkspace } from "../_components/project-workspace";

export default function ProjectWorkspacePage() {
  const params = useParams();
  const projectId = typeof params.id === "string" ? params.id : "";
  return <ProjectWorkspace projectId={projectId} />;
}
