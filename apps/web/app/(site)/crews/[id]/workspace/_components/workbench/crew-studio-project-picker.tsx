"use client";

import { useState } from "react";
import { IconBuilding, IconCircleX, IconLink, IconLoader2, IconLock } from "@tabler/icons-react";
import { toast } from "sonner";
import {
  useCrewStudioProjectOptions,
  useLinkCrewStudioProject,
} from "@/app/(site)/crews/_hooks/use-production";
import type {
  CrewProductionOverviewDTO,
  CrewStudioProjectDisabledReason,
} from "@/app/(site)/crews/_hooks/types";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTranslations } from "@/src/i18n/i18n";

export function CrewStudioProjectPicker({
  crewId,
  value,
  disabled,
}: {
  crewId: string;
  value: CrewProductionOverviewDTO["studioProject"];
  disabled: boolean;
}) {
  const t = useTranslations("crewProduction");
  const tw = useTranslations("crewWorkbench");
  const [open, setOpen] = useState(false);
  const options = useCrewStudioProjectOptions(crewId, open);
  const linkProject = useLinkCrewStudioProject(crewId);
  const select = async (projectId: string | null) => {
    try {
      await linkProject.mutateAsync(projectId);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("properties.projectLinkFailed"));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          color="primary"
          variant="ghost"
          className="min-w-0 max-w-[min(180px,40vw)] shrink rounded-md border-primary/40 text-xs hover:border-primary-hover/40 sm:max-w-[240px]"
          disabled={disabled}
          loading={linkProject.isPending}
          icon={<IconLink className="size-3.5" />}
          aria-label={tw("linkCanvas")}
          title={value?.name ?? tw("linkCanvas")}
        >
          <span className="truncate">{value?.name ?? tw("linkCanvas")}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(420px,calc(100vw-2rem))] p-0">
        <Command>
          <CommandInput placeholder={t("properties.searchStudioProjects")} />
          <CommandList className="max-h-80">
            {options.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                <IconLoader2 className="size-3.5 animate-spin" />
                {t("properties.loadingStudioProjects")}
              </div>
            ) : options.isError ? (
              <div className="px-4 py-6 text-center text-xs text-destructive">
                {options.error instanceof Error
                  ? options.error.message
                  : t("properties.projectOptionsFailed")}
              </div>
            ) : (
              <>
                <CommandEmpty>{t("properties.noStudioProjects")}</CommandEmpty>
                {value ? (
                  <CommandGroup>
                    <CommandItem
                      value={t("properties.unlinkStudioProject")}
                      onSelect={() => void select(null)}
                    >
                      <IconCircleX className="size-3.5" />
                      {t("properties.unlinkStudioProject")}
                    </CommandItem>
                  </CommandGroup>
                ) : null}
                {options.data?.workspaces.map((workspace) => (
                  <CommandGroup
                    key={workspace.id}
                    heading={`${workspace.name} · ${t(
                      workspace.type === "team"
                        ? "properties.teamWorkspace"
                        : "properties.personalWorkspace"
                    )}`}
                  >
                    {workspace.projects.length === 0 ? (
                      <CommandItem disabled value={`${workspace.name} empty`}>
                        <span className="text-muted-foreground">
                          {t("properties.workspaceHasNoProjects")}
                        </span>
                      </CommandItem>
                    ) : (
                      workspace.projects.map((project) => (
                        <CommandItem
                          key={project.id}
                          value={`${workspace.name} ${project.name} ${project.description ?? ""}`}
                          disabled={!project.selectable}
                          data-checked={project.selected || undefined}
                          onSelect={() => void select(project.id)}
                          className="items-start py-2"
                        >
                          {project.selectable ? (
                            <IconBuilding className="mt-0.5 size-3.5 text-muted-foreground" />
                          ) : (
                            <IconLock className="mt-0.5 size-3.5 text-muted-foreground" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-foreground">{project.name}</span>
                            {project.disabledReason ? (
                              <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                                {studioProjectDisabledReason(
                                  t,
                                  project.disabledReason,
                                  project.linkedCrewName
                                )}
                              </span>
                            ) : project.description ? (
                              <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                                {project.description}
                              </span>
                            ) : null}
                          </span>
                        </CommandItem>
                      ))
                    )}
                  </CommandGroup>
                ))}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function studioProjectDisabledReason(
  t: (key: string, params?: Record<string, string | number | Date>) => string,
  reason: CrewStudioProjectDisabledReason,
  crewName: string | null
) {
  if (reason === "already_linked") {
    return t("properties.projectDisabled.alreadyLinked", { crew: crewName ?? "—" });
  }
  return t(`properties.projectDisabled.${reason}`);
}
