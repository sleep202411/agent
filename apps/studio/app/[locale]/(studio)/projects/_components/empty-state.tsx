"use client";

import { useTranslations } from "next-intl";
import { IconFolders, IconPlus } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FrostedPanel } from "@/components/ui/frosted-panel";

export function ProjectsEmptyState() {
  const t = useTranslations("projects");
  return (
    <FrostedPanel className="mt-6 flex flex-col items-center px-6 py-24 text-center">
      <div className="flex size-20 items-center justify-center rounded-full bg-white/[0.04]">
        <IconFolders className="size-10 text-white/25" stroke={1.5} />
      </div>
      <p className="mt-6 text-sm font-medium">{t("noProjectsYet")}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t("noProjectsDescription")}</p>
      <Button
        variant="primary-cta"
        size="lg"
        className="mt-6"
        onClick={() => toast.info(t("projectsComingSoon"))}
      >
        <IconPlus data-icon="inline-start" />
        {t("newProject")}
      </Button>
    </FrostedPanel>
  );
}
