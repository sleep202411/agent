"use client";

import { ProjectsSection } from "../_components/projects-section";

/**
 * Dedicated projects list page reached from the studio sidebar's
 * Projects icon. Mirrors the my-projects block on /art-studio (same
 * padding shell, same `ProjectsSection`), just without the composer
 * hero so users can drill straight into the full project directory.
 */
export default function ArtStudioProjectsPage() {
  return (
    <div className="px-8 pb-24 pt-16">
      <ProjectsSection />
    </div>
  );
}
