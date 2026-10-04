"use client";

import { useId, useLayoutEffect, useRef } from "react";
import { IconCheck, IconMinus } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import type { AssignableShareRole } from "@/lib/collab/sharing-api";
import type { StoryCapability } from "@/lib/story-projects-api";
import { cn } from "@/lib/utils";

const ROLES = ["owner", "producer", "editor", "reviewer", "viewer"] as const;

// Project grants mirror StoryPermissionService. Workspace grants can add to
// these capabilities; the note below explains that effective-access rule.
const ROLE_CAPABILITIES: Record<(typeof ROLES)[number], readonly StoryCapability[]> = {
  owner: [
    "story.read",
    "story.edit",
    "story.generate",
    "story.review",
    "story.build",
    "story.release",
    "story.admin",
  ],
  producer: [
    "story.read",
    "story.edit",
    "story.generate",
    "story.review",
    "story.build",
    "story.release",
  ],
  editor: ["story.read", "story.edit", "story.generate"],
  reviewer: ["story.read", "story.review"],
  viewer: ["story.read"],
};

const PERMISSIONS = [
  { label: "read", capabilities: ["story.read"] },
  { label: "edit", capabilities: ["story.edit"] },
  { label: "generate", capabilities: ["story.generate"] },
  { label: "review", capabilities: ["story.review"] },
  { label: "publish", capabilities: ["story.build", "story.release"] },
  { label: "manage", capabilities: ["story.admin"] },
] as const satisfies ReadonlyArray<{ label: string; capabilities: readonly StoryCapability[] }>;

export function StoryProjectRolePermissionTable({
  selectedRole,
  source,
}: {
  selectedRole: AssignableShareRole | null;
  source: "member" | "link";
}) {
  const t = useTranslations("shell.share.storyRoles");
  const roleLabel = useTranslations("workspace.roles");
  const headingId = useId();
  const noteId = useId();
  const scrollHintId = useId();
  const scrollContainer = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = scrollContainer.current;
    if (!container || !selectedRole) return;
    const revealSelectedRole = () => {
      const header = container.querySelector<HTMLElement>(`thead th[data-role="${selectedRole}"]`);
      const capability = container.querySelector<HTMLElement>("thead th:first-child");
      if (!header || !capability || !container.clientWidth) return;
      const stickyWidth = capability.offsetWidth;
      const left = header.offsetLeft;
      const right = left + header.offsetWidth;
      const visibleLeft = container.scrollLeft + stickyWidth;
      const visibleRight = container.scrollLeft + container.clientWidth;
      let next = container.scrollLeft;
      if (left < visibleLeft) next = left - stickyWidth;
      else if (right > visibleRight) next = right - container.clientWidth;
      container.scrollLeft = Math.max(
        0,
        Math.min(next, container.scrollWidth - container.clientWidth)
      );
    };
    revealSelectedRole();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(revealSelectedRole);
    observer?.observe(container);
    window.addEventListener("resize", revealSelectedRole);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", revealSelectedRole);
    };
  }, [selectedRole]);

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={headingId} className="text-sm font-medium">
          {t("title")}
        </h3>
        {selectedRole && (
          <p role="status" className="text-xs text-muted-foreground">
            {t("selectedFor", { source: t(`sources.${source}`), role: roleLabel(selectedRole) })}
          </p>
        )}
      </div>
      <p id={scrollHintId} className="text-xs text-muted-foreground sm:hidden">
        {t("scrollHint")}
      </p>
      <div
        ref={scrollContainer}
        role="region"
        aria-label={t("tableLabel")}
        aria-describedby={scrollHintId}
        tabIndex={0}
        className="max-w-full overflow-x-auto scroll-auto rounded-lg focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
      >
        <table
          aria-describedby={noteId}
          className="relative w-full min-w-[680px] border-separate border-spacing-0 text-xs"
        >
          <caption className="sr-only">{t("tableLabel")}</caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 w-44 bg-popover px-3 py-3 text-left align-top font-medium text-muted-foreground"
              >
                {t("capability")}
              </th>
              {ROLES.map((role) => (
                <th
                  key={role}
                  scope="col"
                  aria-current={selectedRole === role ? "true" : undefined}
                  data-role={role}
                  data-selected={selectedRole === role ? "true" : undefined}
                  className={cn(
                    "w-32 px-2 py-3 text-center align-top font-medium",
                    selectedRole === role && "bg-white/[0.07]"
                  )}
                >
                  <span className="block text-sm">{roleLabel(role)}</span>
                  <span className="mt-1 block font-normal leading-4 text-muted-foreground">
                    {t(`descriptions.${role}`)}
                  </span>
                  {selectedRole === role && <span className="sr-only">{t("selectedRole")}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map(({ label, capabilities }) => (
              <tr key={label} className="group">
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b border-white/[0.06] bg-popover px-3 py-2.5 text-left font-normal leading-5 group-last:border-b-0"
                >
                  {t(`capabilities.${label}`)}
                </th>
                {ROLES.map((role) => {
                  const allowed = capabilities.every((capability) =>
                    ROLE_CAPABILITIES[role].includes(capability)
                  );
                  return (
                    <td
                      key={role}
                      data-role={role}
                      data-selected={selectedRole === role ? "true" : undefined}
                      className={cn(
                        "border-b border-white/[0.06] px-2 py-2.5 text-center group-last:border-b-0",
                        selectedRole === role && "bg-white/[0.07]"
                      )}
                    >
                      {allowed ? (
                        <IconCheck aria-hidden="true" className="mx-auto size-4 text-foreground" />
                      ) : (
                        <IconMinus
                          aria-hidden="true"
                          className="mx-auto size-4 text-muted-foreground/50"
                        />
                      )}
                      <span className="sr-only">{allowed ? t("allowed") : t("notAllowed")}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div id={noteId} className="space-y-1 text-xs leading-5 text-muted-foreground">
        <p>{t("ownerNote")}</p>
        <p>{t("scopeNote")}</p>
      </div>
    </section>
  );
}
