"use client";

import * as React from "react";
import { DayPicker, getDefaultClassNames, type DayButton, type Locale } from "react-day-picker";
import { IconChevronDown, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  locale,
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  const defaultClassNames = getDefaultClassNames();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      locale={locale}
      className={cn(
        "group/calendar bg-transparent p-2 [--cell-radius:var(--radius-md)] [--cell-size:1.75rem]",
        className
      )}
      formatters={{
        formatMonthDropdown: (date) => date.toLocaleString(locale?.code, { month: "short" }),
        ...formatters,
      }}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn("relative flex flex-col gap-4 md:flex-row", defaultClassNames.months),
        month: cn("flex w-full flex-col gap-3", defaultClassNames.month),
        nav: cn(
          "absolute inset-x-0 top-0 flex items-center justify-between",
          defaultClassNames.nav
        ),
        button_previous: cn(
          buttonVariants({ variant: "ghost", color: "muted", size: "icon-xs" }),
          "z-10",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost", color: "muted", size: "icon-xs" }),
          "z-10",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          "flex h-(--cell-size) items-center justify-center px-(--cell-size)",
          defaultClassNames.month_caption
        ),
        caption_label: cn("text-xs font-medium select-none", defaultClassNames.caption_label),
        month_grid: cn("w-full border-collapse", defaultClassNames.month_grid),
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "flex-1 text-center text-[10px] font-normal text-muted-foreground select-none",
          defaultClassNames.weekday
        ),
        week: cn("mt-1 flex w-full", defaultClassNames.week),
        day: cn(
          "group/day relative aspect-square h-full w-full p-0 text-center",
          defaultClassNames.day
        ),
        today: cn("rounded-(--cell-radius) bg-muted text-foreground", defaultClassNames.today),
        outside: cn("text-muted-foreground/50", defaultClassNames.outside),
        disabled: cn(
          "pointer-events-none text-muted-foreground opacity-35",
          defaultClassNames.disabled
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className: rootClassName, rootRef, ...rootProps }) => (
          <div data-slot="calendar" ref={rootRef} className={cn(rootClassName)} {...rootProps} />
        ),
        Chevron: ({ className: chevronClassName, orientation, ...chevronProps }) => {
          if (orientation === "left") {
            return (
              <IconChevronLeft className={cn("size-3.5", chevronClassName)} {...chevronProps} />
            );
          }
          if (orientation === "right") {
            return (
              <IconChevronRight className={cn("size-3.5", chevronClassName)} {...chevronProps} />
            );
          }
          return <IconChevronDown className={cn("size-3.5", chevronClassName)} {...chevronProps} />;
        },
        DayButton: (dayButtonProps) => <CalendarDayButton locale={locale} {...dayButtonProps} />,
        ...components,
      }}
      {...props}
    />
  );
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  locale,
  ...props
}: Omit<React.ComponentProps<typeof DayButton>, "color"> & { locale?: Partial<Locale> }) {
  const ref = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <Button
      ref={ref}
      variant="ghost"
      color="muted"
      size="icon-xs"
      data-day={day.date.toLocaleDateString(locale?.code)}
      data-selected={modifiers.selected}
      className={cn(
        "size-(--cell-size) rounded-(--cell-radius) border-0 p-0 text-[11px] font-normal data-[selected=true]:bg-foreground data-[selected=true]:text-background",
        className
      )}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
