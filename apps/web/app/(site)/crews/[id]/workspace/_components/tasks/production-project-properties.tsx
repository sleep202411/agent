"use client";

import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import type { LookupUserDTO } from "@repo/shared/users";
import {
  IconArrowRight,
  IconCalendar,
  IconCircle,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconClockHour4,
  IconDots,
  IconFlag3,
  IconPlus,
  IconTag,
  IconUsers,
  IconUserCircle,
  type Icon,
} from "@tabler/icons-react";
import { format } from "date-fns";
import { enUS, zhCN, zhHK } from "date-fns/locale";
import { toast } from "sonner";

import {
  useUpdateCrewProductionProject,
  type CrewMemberDTO,
  type CrewProductionDateGranularity,
  type CrewProductionOverviewDTO,
  type CrewProductionStatus,
  type CrewTaskLabelDTO,
  type CrewTaskPriority,
  type UpdateCrewProductionProjectInput,
} from "@/app/(site)/crews/_hooks/use-crew";
import { CrewLogo } from "@/app/(site)/messages/_components/crew-logo";
import { UserAvatar } from "@/components/user-avatar";
import { Calendar } from "@/components/ui/calendar";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import {
  ProductionPropertyButton,
  ProductionPropertyMenu,
  type ProductionPropertyOption,
} from "./production-property-menu";

const STATUS_CONFIG: Record<CrewProductionStatus, { icon: Icon; className: string }> = {
  backlog: { icon: IconCircleDashed, className: "text-[#8a9099]" },
  planned: { icon: IconCircle, className: "text-[#aeb4bd]" },
  in_progress: { icon: IconClockHour4, className: "text-[#e0ad3b]" },
  completed: { icon: IconCircleCheck, className: "text-[#7f85ff]" },
  cancelled: { icon: IconCircleX, className: "text-[#737983]" },
};

const PRIORITIES: Array<CrewTaskPriority | null> = [null, "urgent", "high", "normal", "low"];

export function ProductionProjectProperties({
  crewId,
  crewName,
  crewLogo,
  members,
  displays,
  overview,
}: {
  crewId: string;
  crewName: string;
  crewLogo: string;
  members: CrewMemberDTO[];
  displays: Map<string, LookupUserDTO>;
  overview: CrewProductionOverviewDTO;
}) {
  const t = useTranslations("crewProduction");
  const updateProject = useUpdateCrewProductionProject(crewId);
  const lead = members.find((member) => member.id === overview.project.leadMemberId) ?? null;
  const disabled = !overview.capabilities.manage || updateProject.isPending;

  const updateProperty = async (
    input: Omit<UpdateCrewProductionProjectInput, "expectedVersion">,
    expectedVersion = overview.project.version
  ) => {
    try {
      await updateProject.mutateAsync({ expectedVersion, ...input });
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("properties.saveFailed"));
      return false;
    }
  };

  return (
    <>
      <PropertyRow label={t("properties.title")}>
        <StatusPicker
          value={overview.project.status}
          disabled={disabled}
          onChange={(status) => void updateProperty({ status })}
        />
        <PriorityPicker
          value={overview.project.priority}
          disabled={disabled}
          onChange={(priority) => void updateProperty({ priority })}
        />
        <LeadPicker
          value={lead}
          members={members}
          displays={displays}
          disabled={disabled}
          onChange={(leadMemberId) => void updateProperty({ leadMemberId })}
        />
        <ProjectDatePicker
          version={overview.project.version}
          kind="start"
          value={overview.project.startDate}
          granularity={overview.project.startDateGranularity}
          boundary={overview.project.targetDate}
          boundaryGranularity={overview.project.targetDateGranularity}
          disabled={disabled}
          onChange={(startDate, startDateGranularity, version) =>
            updateProperty({ startDate, startDateGranularity }, version)
          }
        />
        {overview.project.startDate ? <IconArrowRight className="size-3 text-[#5f646d]" /> : null}
        <ProjectDatePicker
          version={overview.project.version}
          kind="target"
          value={overview.project.targetDate}
          granularity={overview.project.targetDateGranularity}
          boundary={overview.project.startDate}
          boundaryGranularity={overview.project.startDateGranularity}
          disabled={disabled}
          onChange={(targetDate, targetDateGranularity, version) =>
            updateProperty({ targetDate, targetDateGranularity }, version)
          }
        />
        <Link
          href="?tab=members"
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[#8f949d] transition-colors hover:bg-white/[0.045] hover:text-[#d7dade] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          <CrewLogo logo={crewLogo} name={crewName} crewId={crewId} className="size-4 rounded" />
          <span>{crewName}</span>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ProductionPropertyButton aria-label={t("properties.more")}>
              <IconDots className="size-3.5" />
            </ProductionPropertyButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem asChild>
              <Link href="?tab=members">
                <IconUsers />
                {t("properties.members")}
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PropertyRow>

      <PropertyRow label={t("properties.labels")}>
        <LabelPicker
          selected={overview.labels}
          options={overview.labelOptions}
          disabled={disabled}
          onChange={(labelIds) => void updateProperty({ labelIds })}
        />
      </PropertyRow>
    </>
  );
}

function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <span className="w-[74px] shrink-0 pt-1 text-[#747983]">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

function StatusPicker({
  value,
  disabled,
  onChange,
}: {
  value: CrewProductionStatus;
  disabled: boolean;
  onChange: (value: CrewProductionStatus) => void;
}) {
  const t = useTranslations("crewProduction");
  const [open, setOpen] = useState(false);
  const statuses = Object.keys(STATUS_CONFIG) as CrewProductionStatus[];
  const options = statuses.map((status, index): ProductionPropertyOption<CrewProductionStatus> => {
    const ItemIcon = STATUS_CONFIG[status].icon;
    return {
      value: status,
      label: t(`status.${status}`),
      icon: <ItemIcon className={cn("size-3.5", STATUS_CONFIG[status].className)} />,
      shortcut: String(index + 1),
    };
  });
  const CurrentIcon = STATUS_CONFIG[value].icon;

  return (
    <ProductionPropertyMenu
      open={open}
      onOpenChange={setOpen}
      disabled={disabled}
      value={value}
      options={options}
      searchPlaceholder={t("properties.changeStatus")}
      emptyLabel={t("properties.noMatches")}
      onSelect={onChange}
      trigger={
        <ProductionPropertyButton aria-label={t("properties.changeStatus")} aria-keyshortcuts="P S">
          <CurrentIcon className={cn("size-3.5", STATUS_CONFIG[value].className)} />
          {t(`status.${value}`)}
        </ProductionPropertyButton>
      }
    />
  );
}

function PriorityPicker({
  value,
  disabled,
  onChange,
}: {
  value: CrewTaskPriority | null;
  disabled: boolean;
  onChange: (value: CrewTaskPriority | null) => void;
}) {
  const t = useTranslations("crewProduction");
  const [open, setOpen] = useState(false);
  const options = PRIORITIES.map(
    (priority, index): ProductionPropertyOption<CrewTaskPriority | null> => ({
      value: priority,
      label: priority ? t(`priority.${priority}`) : t("priority.none"),
      icon: <IconFlag3 className={cn("size-3.5", priorityColor(priority))} />,
      shortcut: String(index),
    })
  );

  return (
    <ProductionPropertyMenu
      open={open}
      onOpenChange={setOpen}
      disabled={disabled}
      value={value}
      options={options}
      searchPlaceholder={t("properties.searchPriorities")}
      emptyLabel={t("properties.noMatches")}
      onSelect={onChange}
      trigger={
        <ProductionPropertyButton
          aria-label={t("properties.searchPriorities")}
          aria-keyshortcuts="P P"
        >
          <IconFlag3 className={cn("size-3.5", priorityColor(value))} />
          {value ? t(`priority.${value}`) : t("priority.none")}
        </ProductionPropertyButton>
      }
    />
  );
}

function LeadPicker({
  value,
  members,
  displays,
  disabled,
  onChange,
}: {
  value: CrewMemberDTO | null;
  members: CrewMemberDTO[];
  displays: Map<string, LookupUserDTO>;
  disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  const t = useTranslations("crewProduction");
  const [open, setOpen] = useState(false);
  const options: Array<ProductionPropertyOption<string | null>> = [
    {
      value: null,
      label: t("properties.noLead"),
      icon: <IconUserCircle className="size-3.5 text-[#777d87]" />,
    },
    ...members.map((member) => ({
      value: member.id,
      label: memberName(member, displays, t("properties.unknownMember", { id: member.userId })),
      icon: (
        <UserAvatar
          src={displays.get(member.userId)?.avatar}
          seed={member.userId}
          name={memberName(member, displays, t("properties.unknownMember", { id: member.userId }))}
          size={18}
        />
      ),
    })),
  ];

  return (
    <ProductionPropertyMenu
      open={open}
      onOpenChange={setOpen}
      disabled={disabled}
      value={value?.id ?? null}
      options={options}
      searchPlaceholder={t("properties.searchMembers")}
      emptyLabel={t("properties.noMatches")}
      onSelect={onChange}
      trigger={
        <ProductionPropertyButton aria-label={t("properties.lead")} aria-keyshortcuts="P A">
          {value ? (
            <UserAvatar
              src={displays.get(value.userId)?.avatar}
              seed={value.userId}
              name={memberName(
                value,
                displays,
                t("properties.unknownMember", { id: value.userId })
              )}
              size={16}
            />
          ) : (
            <IconUserCircle className="size-3.5 text-[#7d838d]" />
          )}
          {value
            ? memberName(value, displays, t("properties.unknownMember", { id: value.userId }))
            : t("properties.lead")}
        </ProductionPropertyButton>
      }
    />
  );
}

function ProjectDatePicker({
  version,
  kind,
  value,
  granularity,
  boundary,
  boundaryGranularity,
  disabled,
  onChange,
}: {
  version: number;
  kind: "start" | "target";
  value: string | null;
  granularity: CrewProductionDateGranularity;
  boundary: string | null;
  boundaryGranularity: CrewProductionDateGranularity;
  disabled: boolean;
  onChange: (
    value: string | null,
    granularity: CrewProductionDateGranularity,
    version: number
  ) => Promise<boolean>;
}) {
  const t = useTranslations("crewProduction");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [draftVersion, setDraftVersion] = useState(version);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [activeGranularity, setActiveGranularity] =
    useState<CrewProductionDateGranularity>(granularity);
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState(false);
  const selected = value ? fromDateKey(value) : undefined;
  const boundaryDate = boundary ? fromDateKey(boundary) : null;
  const label = kind === "start" ? t("properties.startDate") : t("properties.targetDate");
  const calendarLocale = locale === "zh-CN" ? zhCN : locale === "zh-HK" ? zhHK : enUS;
  const granularities: CrewProductionDateGranularity[] = [
    "day",
    "month",
    "quarter",
    "half_year",
    "year",
  ];

  const save = async (date: string | null, precision: CrewProductionDateGranularity) => {
    if (disabled || pending.current) return;
    pending.current = true;
    setSaving(true);
    try {
      if (await onChange(date, precision, draftVersion)) setOpen(false);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  const choose = (date: Date, nextGranularity = activeGranularity) => {
    const canonical = canonicalProjectDate(date, nextGranularity);
    if (
      !isProjectDateAllowed(canonical, nextGranularity, kind, boundaryDate, boundaryGranularity)
    ) {
      setInputError(true);
      return;
    }
    void save(toDateKey(canonical), nextGranularity);
  };

  const submitDirectDate = (event: FormEvent) => {
    event.preventDefault();
    if (!inputValue.trim()) {
      void save(null, activeGranularity);
      return;
    }
    const parsed = parseProjectDateInput(inputValue, activeGranularity);
    if (!parsed) {
      setInputError(true);
      return;
    }
    choose(parsed);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (pending.current) return;
        if (nextOpen) {
          setDraftVersion(version);
          setActiveGranularity(granularity);
          setInputValue(value ? formatProjectDateInput(value, granularity) : "");
          setInputError(false);
        }
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <ProductionPropertyButton disabled={disabled} aria-label={label} aria-keyshortcuts="P D">
          <IconCalendar className="size-3.5 text-[#8a9099]" />
          {value ? formatProjectDate(value, granularity, locale) : label}
        </ProductionPropertyButton>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[300px] gap-0 overflow-hidden rounded-lg border border-white/[0.1] bg-[#17181c] p-0 shadow-[0_22px_70px_rgba(0,0,0,.58)]"
      >
        <fieldset disabled={saving || disabled} className="contents">
          <div className="flex items-center justify-between border-b border-white/[0.07] px-3 py-2 text-[11px] font-medium text-[#c8cbd0]">
            <span>{label}</span>
            <kbd className="font-sans font-normal text-[#626872]">Ctrl ⌥ S</kbd>
          </div>
          <form onSubmit={submitDirectDate} className="px-3 pt-2.5">
            <input
              autoFocus
              value={inputValue}
              onChange={(event) => {
                setInputValue(event.target.value);
                setInputError(false);
              }}
              aria-label={t("properties.dateInput")}
              aria-invalid={inputError}
              placeholder={t("properties.dateInputPlaceholder")}
              className={cn(
                "h-8 w-full rounded-md border bg-[#111216] px-2.5 text-[12px] text-[#d9dce1] outline-none placeholder:text-[#5f646e] focus:border-[#7b85ff] focus:ring-1 focus:ring-[#7b85ff]/30",
                inputError ? "border-[#e35d5d]" : "border-white/[0.1]"
              )}
            />
          </form>
          <div role="tablist" className="flex gap-1 px-3 py-2">
            {granularities.map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={activeGranularity === item}
                onClick={() => {
                  setActiveGranularity(item);
                  setInputValue(value ? formatProjectDateInput(value, item) : "");
                  setInputError(false);
                }}
                className={cn(
                  "h-6 flex-1 rounded-md px-1 text-[10px] text-[#80858e] transition-colors hover:bg-white/[0.045] hover:text-[#c9ccd2]",
                  activeGranularity === item && "bg-white/[0.07] text-[#e3e5e8]"
                )}
              >
                {t(`properties.dateGranularity.${item}`)}
              </button>
            ))}
          </div>
          {activeGranularity === "day" ? (
            <Calendar
              mode="single"
              locale={calendarLocale}
              selected={granularity === "day" ? selected : undefined}
              defaultMonth={selected ?? boundaryDate ?? undefined}
              disabled={(date) =>
                !isProjectDateAllowed(date, "day", kind, boundaryDate, boundaryGranularity)
              }
              onSelect={(date) => date && choose(date, "day")}
            />
          ) : (
            <ProjectPeriodGrid
              granularity={activeGranularity}
              selected={selected}
              selectedGranularity={granularity}
              locale={locale}
              disabled={(date) =>
                !isProjectDateAllowed(
                  date,
                  activeGranularity,
                  kind,
                  boundaryDate,
                  boundaryGranularity
                )
              }
              onSelect={(date) => choose(date)}
            />
          )}
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}

function ProjectPeriodGrid({
  granularity,
  selected,
  selectedGranularity,
  locale,
  disabled,
  onSelect,
}: {
  granularity: Exclude<CrewProductionDateGranularity, "day">;
  selected: Date | undefined;
  selectedGranularity: CrewProductionDateGranularity;
  locale: string;
  disabled: (date: Date) => boolean;
  onSelect: (date: Date) => void;
}) {
  const t = useTranslations("crewProduction");
  const centerYear = selected?.getFullYear() ?? new Date().getFullYear();
  const years = Array.from({ length: 10 }, (_, index) => centerYear - 4 + index);
  const periodCount =
    granularity === "month"
      ? 12
      : granularity === "quarter"
        ? 4
        : granularity === "half_year"
          ? 2
          : 1;

  return (
    <div className="max-h-[282px] overflow-y-auto border-t border-white/[0.06] px-3 py-2 scrollbar-thin">
      {years.map((year) => (
        <div key={year} className="mb-2.5 last:mb-0">
          <div className="mb-1 text-[10px] font-medium text-[#676c75]">{year}</div>
          <div
            className={cn(
              "grid gap-1",
              periodCount === 12
                ? "grid-cols-6"
                : periodCount === 4
                  ? "grid-cols-4"
                  : periodCount === 2
                    ? "grid-cols-2"
                    : "grid-cols-1"
            )}
          >
            {Array.from({ length: periodCount }, (_, index) => {
              const month =
                granularity === "month"
                  ? index
                  : granularity === "quarter"
                    ? index * 3
                    : granularity === "half_year"
                      ? index * 6
                      : 0;
              const date = new Date(year, month, 1);
              const isSelected =
                selectedGranularity === granularity &&
                selected?.getFullYear() === year &&
                selected.getMonth() === month;
              const buttonLabel =
                granularity === "month"
                  ? new Intl.DateTimeFormat(locale, { month: "short" }).format(date)
                  : granularity === "quarter"
                    ? t("properties.datePeriod.quarter", { number: index + 1 })
                    : granularity === "half_year"
                      ? t("properties.datePeriod.halfYear", { number: index + 1 })
                      : String(year);
              return (
                <button
                  key={`${year}-${month}`}
                  type="button"
                  disabled={disabled(date)}
                  aria-pressed={isSelected}
                  onClick={() => onSelect(date)}
                  className={cn(
                    "h-7 rounded-md px-1 text-[10px] text-[#969ba4] transition-colors hover:bg-white/[0.055] hover:text-[#e0e2e5] disabled:pointer-events-none disabled:opacity-30",
                    isSelected && "bg-[#6972e8] text-white hover:bg-[#6972e8]"
                  )}
                >
                  {buttonLabel}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function LabelPicker({
  selected,
  options,
  disabled,
  onChange,
}: {
  selected: CrewTaskLabelDTO[];
  options: CrewTaskLabelDTO[];
  disabled: boolean;
  onChange: (labelIds: string[]) => void;
}) {
  const t = useTranslations("crewProduction");
  const [open, setOpen] = useState(false);
  const selectedIds = useMemo(() => new Set(selected.map((label) => label.id)), [selected]);

  const toggle = (labelId: string) => {
    const next = new Set(selectedIds);
    if (next.has(labelId)) next.delete(labelId);
    else next.add(labelId);
    onChange([...next]);
  };

  return (
    <>
      {selected.map((label) => (
        <span
          key={label.id}
          className="flex h-7 items-center gap-1.5 rounded-md bg-white/[0.035] px-2 text-[#a8adb5]"
        >
          <span className="size-2 rounded-full" style={{ backgroundColor: label.color }} />
          <span>{label.name}</span>
        </span>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <ProductionPropertyButton disabled={disabled} aria-keyshortcuts="P L">
            {selected.length === 0 ? (
              <IconTag className="size-3.5 text-[#7d838d]" />
            ) : (
              <IconPlus className="size-3.5" />
            )}
            {selected.length === 0 ? t("properties.addLabel") : t("properties.addAnotherLabel")}
          </ProductionPropertyButton>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-60 gap-0 overflow-hidden rounded-lg border border-white/[0.1] bg-[#17181c] p-0 shadow-[0_22px_70px_rgba(0,0,0,.58)]"
        >
          <Command>
            <CommandInput autoFocus placeholder={t("properties.searchLabels")} />
            <CommandList className="p-1">
              <CommandEmpty>{t("properties.noLabels")}</CommandEmpty>
              {options.map((label) => (
                <CommandItem
                  key={label.id}
                  value={`${label.name} ${label.description}`}
                  data-checked={selectedIds.has(label.id)}
                  onSelect={() => toggle(label.id)}
                >
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                  <span className="min-w-0 flex-1 truncate">{label.name}</span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  );
}

function memberName(member: CrewMemberDTO, displays: Map<string, LookupUserDTO>, fallback: string) {
  return displays.get(member.userId)?.nickname?.trim() || fallback;
}

function priorityColor(priority: CrewTaskPriority | null) {
  if (priority === "urgent") return "text-[#ef5f5f]";
  if (priority === "high") return "text-[#e19a4c]";
  if (priority === "normal") return "text-[#d3b75d]";
  if (priority === "low") return "text-[#7b9bd1]";
  return "text-[#7b818b]";
}

function fromDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDateKey(value: Date) {
  return format(value, "yyyy-MM-dd");
}

function formatProjectDate(
  value: string,
  granularity: CrewProductionDateGranularity,
  locale: string
) {
  const date = fromDateKey(value);
  if (granularity === "year") return String(date.getFullYear());
  if (granularity === "quarter") {
    return `${date.getFullYear()} Q${Math.floor(date.getMonth() / 3) + 1}`;
  }
  if (granularity === "half_year") {
    return `${date.getFullYear()} H${date.getMonth() < 6 ? 1 : 2}`;
  }
  return new Intl.DateTimeFormat(locale, {
    month: granularity === "month" ? "long" : "short",
    ...(granularity === "day" ? { day: "numeric" } : {}),
    ...(date.getFullYear() !== new Date().getFullYear() || granularity === "month"
      ? { year: "numeric" }
      : {}),
  }).format(date);
}

function formatProjectDateInput(value: string, granularity: CrewProductionDateGranularity) {
  const date = canonicalProjectDate(fromDateKey(value), granularity);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  if (granularity === "day") return toDateKey(date);
  if (granularity === "month") return `${year}-${month}`;
  if (granularity === "quarter") return `${year}-Q${Math.floor(date.getMonth() / 3) + 1}`;
  if (granularity === "half_year") return `${year}-H${date.getMonth() < 6 ? 1 : 2}`;
  return String(year);
}

function parseProjectDateInput(value: string, granularity: CrewProductionDateGranularity) {
  const normalized = value.trim().toUpperCase();
  let match: RegExpMatchArray | null;
  if (granularity === "day") {
    match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return validLocalDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  if (granularity === "month") {
    match = normalized.match(/^(\d{4})-(\d{1,2})$/);
    if (!match) return null;
    return validLocalDate(Number(match[1]), Number(match[2]) - 1, 1);
  }
  if (granularity === "quarter") {
    match = normalized.match(/^(\d{4})-?Q([1-4])$/);
    if (!match) return null;
    return validLocalDate(Number(match[1]), (Number(match[2]) - 1) * 3, 1);
  }
  if (granularity === "half_year") {
    match = normalized.match(/^(\d{4})-?H([1-2])$/);
    if (!match) return null;
    return validLocalDate(Number(match[1]), (Number(match[2]) - 1) * 6, 1);
  }
  match = normalized.match(/^(\d{4})$/);
  return match ? validLocalDate(Number(match[1]), 0, 1) : null;
}

function validLocalDate(year: number, month: number, day: number) {
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    ? date
    : null;
}

function canonicalProjectDate(date: Date, granularity: CrewProductionDateGranularity) {
  const month = date.getMonth();
  const canonicalMonth =
    granularity === "quarter"
      ? Math.floor(month / 3) * 3
      : granularity === "half_year"
        ? Math.floor(month / 6) * 6
        : granularity === "year"
          ? 0
          : month;
  return new Date(date.getFullYear(), canonicalMonth, granularity === "day" ? date.getDate() : 1);
}

function projectPeriodEnd(date: Date, granularity: CrewProductionDateGranularity) {
  const start = canonicalProjectDate(date, granularity);
  if (granularity === "day") return start;
  const months =
    granularity === "month"
      ? 1
      : granularity === "quarter"
        ? 3
        : granularity === "half_year"
          ? 6
          : 12;
  return new Date(start.getFullYear(), start.getMonth() + months, 0);
}

function isProjectDateAllowed(
  date: Date,
  granularity: CrewProductionDateGranularity,
  kind: "start" | "target",
  boundary: Date | null,
  boundaryGranularity: CrewProductionDateGranularity
) {
  if (!boundary) return true;
  const candidateStart = canonicalProjectDate(date, granularity);
  const candidateEnd = projectPeriodEnd(date, granularity);
  const boundaryStart = canonicalProjectDate(boundary, boundaryGranularity);
  const boundaryEnd = projectPeriodEnd(boundary, boundaryGranularity);
  return kind === "start" ? candidateStart <= boundaryEnd : candidateEnd >= boundaryStart;
}
