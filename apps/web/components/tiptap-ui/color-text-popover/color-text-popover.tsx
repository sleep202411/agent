"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";

// --- Hooks ---
import { useMenuNavigation } from "@/hooks/use-menu-navigation";
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";

// --- Icons ---
import { ChevronDownIcon } from "@/components/tiptap-icons/chevron-down-icon";

// --- Tiptap UI ---
import type {
  ColorType,
  ColorItem,
  ColorValueResolver,
  RecentColor,
  UseColorTextPopoverConfig,
} from "@/components/tiptap-ui/color-text-popover";
import {
  useColorTextPopover,
  useRecentColors,
  getColorByValue,
} from "@/components/tiptap-ui/color-text-popover";
import { TEXT_COLORS, ColorTextButton } from "@/components/tiptap-ui/color-text-button";
import {
  HIGHLIGHT_COLORS,
  ColorHighlightButton,
} from "@/components/tiptap-ui/color-highlight-button";

// --- UI Primitives ---
import type { ButtonProps } from "@/components/tiptap-ui-primitive/button";
import { Button } from "@/components/tiptap-ui-primitive/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/tiptap-ui-primitive/popover";
import {
  Card,
  CardBody,
  CardGroupLabel,
  CardItemGroup,
} from "@/components/tiptap-ui-primitive/card";

// --- Utils ---
import { chunkArray } from "@/lib/tiptap-advanced-utils";

// --- Styles ---
import "@/components/tiptap-ui/color-text-popover/color-text-popover.scss";
import { ButtonGroup } from "@/components/tiptap-ui-primitive/button-group";

// ─── Shared types ────────────────────────────────────────────────────────────

type ColorChangePayload = {
  type: ColorType;
  label: string;
  value: string;
};

// ─── RecentColorButton ───────────────────────────────────────────────────────

export interface RecentColorButtonProps extends ButtonProps {
  colorObj: RecentColor;
  withLabel?: boolean;
  onColorChanged?: (payload: ColorChangePayload) => void;
  editor?: Editor | null;
  resolveColorValue?: ColorValueResolver;
}

export function RecentColorButton({
  colorObj,
  withLabel = false,
  onColorChanged,
  editor,
  resolveColorValue,
  ...props
}: RecentColorButtonProps) {
  const colorSet = colorObj.type === "text" ? TEXT_COLORS : HIGHLIGHT_COLORS;
  const color = getColorByValue(colorObj.value, colorSet);
  const label = color.label === color.value ? colorObj.label : color.label;
  const resolvedValue =
    resolveColorValue?.({
      type: colorObj.type,
      label,
      value: colorObj.value,
    }) ?? colorObj.value;

  const commonProps = {
    tooltip: label,
    text: withLabel ? label : undefined,
    onApplied: () =>
      onColorChanged?.({
        type: colorObj.type,
        label,
        value: color.value,
      }),
    ...props,
  };

  return colorObj.type === "text" ? (
    <ColorTextButton textColor={resolvedValue} label={label} editor={editor} {...commonProps} />
  ) : (
    <ColorHighlightButton
      highlightColor={resolvedValue}
      label={label}
      editor={editor}
      {...commonProps}
    />
  );
}

// ─── ColorGroup ──────────────────────────────────────────────────────────────

export interface ColorGroupProps {
  type: ColorType;
  colors: ColorItem[][];
  onColorSelected: (payload: ColorChangePayload) => void;
  selectedIndex?: number;
  startIndexOffset: number;
  editor?: Editor | null;
  resolveColorValue?: ColorValueResolver;
}

export function ColorGroup({
  type,
  colors,
  onColorSelected,
  selectedIndex,
  startIndexOffset,
  editor,
  resolveColorValue,
}: ColorGroupProps) {
  return colors.map((group, groupIndex) => (
    <ButtonGroup key={`${type}-group-${groupIndex}`}>
      {group.map((color, colorIndex) => {
        const itemIndex =
          startIndexOffset +
          colors.slice(0, groupIndex).reduce((acc, g) => acc + g.length, 0) +
          colorIndex;

        const isHighlighted = selectedIndex === itemIndex;
        const resolvedValue =
          resolveColorValue?.({
            type,
            label: color.label,
            value: color.value,
          }) ?? color.value;

        const commonProps = {
          tooltip: color.label,
          onApplied: () => onColorSelected({ type, label: color.label, value: color.value }),
          tabIndex: isHighlighted ? 0 : -1,
          "data-highlighted": isHighlighted,
          "aria-label": `${color.label} ${type === "text" ? "text" : "highlight"} color`,
        };

        return type === "text" ? (
          <ButtonGroup key={`${type}-${color.value}-${colorIndex}`}>
            <ColorTextButton
              textColor={resolvedValue}
              label={color.label}
              editor={editor}
              {...commonProps}
            />
          </ButtonGroup>
        ) : (
          <ButtonGroup key={`${type}-${color.value}-${colorIndex}`}>
            <ColorHighlightButton
              highlightColor={resolvedValue}
              label={color.label}
              editor={editor}
              {...commonProps}
            />
          </ButtonGroup>
        );
      })}
    </ButtonGroup>
  ));
}

// ─── RecentColorsSection ─────────────────────────────────────────────────────

interface RecentColorsSectionProps {
  recentColors: RecentColor[];
  onColorSelected: (payload: ColorChangePayload) => void;
  selectedIndex?: number;
  editor?: Editor | null;
  resolveColorValue?: ColorValueResolver;
}

function RecentColorsSection({
  recentColors,
  onColorSelected,
  selectedIndex,
  editor,
  resolveColorValue,
}: RecentColorsSectionProps) {
  if (recentColors.length === 0) return null;

  return (
    <CardItemGroup>
      <CardGroupLabel>Recently used</CardGroupLabel>
      <ButtonGroup>
        {recentColors.map((colorObj, index) => (
          <ButtonGroup key={`recent-${colorObj.type}-${colorObj.value}`}>
            <RecentColorButton
              colorObj={colorObj}
              onColorChanged={onColorSelected}
              tabIndex={selectedIndex === index ? 0 : -1}
              data-highlighted={selectedIndex === index}
              editor={editor}
              resolveColorValue={resolveColorValue}
            />
          </ButtonGroup>
        ))}
      </ButtonGroup>
    </CardItemGroup>
  );
}

// ─── TextStyleColorPanel ─────────────────────────────────────────────────────

export interface TextStyleColorPanelProps {
  maxColorsPerGroup?: number;
  maxRecentColors?: number;
  onColorChanged?: (payload: ColorChangePayload) => void;
  editor?: Editor | null;
  resolveColorValue?: ColorValueResolver;
}

export function TextStyleColorPanel({
  maxColorsPerGroup = 5,
  maxRecentColors = 3,
  onColorChanged,
  editor,
  resolveColorValue,
}: TextStyleColorPanelProps) {
  const { recentColors, addRecentColor, isInitialized } = useRecentColors(maxRecentColors);
  const containerRef = useRef<HTMLDivElement>(null);

  const textColorGroups = useMemo(
    () => chunkArray(TEXT_COLORS, maxColorsPerGroup),
    [maxColorsPerGroup]
  );

  const highlightColorGroups = useMemo(
    () => chunkArray(HIGHLIGHT_COLORS, maxColorsPerGroup),
    [maxColorsPerGroup]
  );

  const allTextColors = useMemo(() => textColorGroups.flat(), [textColorGroups]);
  const allHighlightColors = useMemo(() => highlightColorGroups.flat(), [highlightColorGroups]);

  const textColorStartIndex = useMemo(
    () => (isInitialized ? recentColors.length : 0),
    [isInitialized, recentColors.length]
  );

  const highlightColorStartIndex = useMemo(
    () => textColorStartIndex + allTextColors.length,
    [textColorStartIndex, allTextColors.length]
  );

  const menuItems = useMemo(() => {
    const items = [];

    if (isInitialized && recentColors.length > 0) {
      items.push(
        ...recentColors.map((color) => ({
          type: color.type,
          value: color.value,
          label: `Recent ${color.type === "text" ? "text" : "highlight"} color`,
          group: "recent",
        }))
      );
    }

    items.push(
      ...allTextColors.map((color) => ({
        type: "text" as ColorType,
        value: color.value,
        label: color.label,
        group: "text",
      }))
    );

    items.push(
      ...allHighlightColors.map((color) => ({
        type: "highlight" as ColorType,
        value: color.value,
        label: color.label,
        group: "highlight",
      }))
    );

    return items;
  }, [isInitialized, recentColors, allTextColors, allHighlightColors]);

  const handleColorSelected = useCallback(
    ({ type, label, value }: ColorChangePayload) => {
      if (!containerRef.current) return false;

      const highlighted = containerRef.current.querySelector(
        '[data-highlighted="true"]'
      ) as HTMLElement | null;

      highlighted?.click();

      addRecentColor({ type, label, value });
      onColorChanged?.({ type, label, value });
    },
    [addRecentColor, onColorChanged]
  );

  const { selectedIndex } = useMenuNavigation({
    containerRef,
    items: menuItems,
    onSelect: (item) => {
      if (item)
        handleColorSelected({
          type: item.type,
          label: item.label,
          value: item.value,
        });
    },
    orientation: "both",
    autoSelectFirstItem: false,
  });

  return (
    <Card ref={containerRef} tabIndex={0} role="menu">
      <CardBody>
        {isInitialized && (
          <RecentColorsSection
            recentColors={recentColors}
            onColorSelected={handleColorSelected}
            selectedIndex={selectedIndex}
            editor={editor}
            resolveColorValue={resolveColorValue}
          />
        )}

        <CardItemGroup>
          <CardGroupLabel>Text color</CardGroupLabel>
          <ColorGroup
            type="text"
            colors={textColorGroups}
            onColorSelected={handleColorSelected}
            selectedIndex={selectedIndex}
            startIndexOffset={textColorStartIndex}
            editor={editor}
            resolveColorValue={resolveColorValue}
          />
        </CardItemGroup>

        <CardItemGroup>
          <CardGroupLabel>Highlight color</CardGroupLabel>
          <ColorGroup
            type="highlight"
            colors={highlightColorGroups}
            onColorSelected={handleColorSelected}
            selectedIndex={selectedIndex}
            startIndexOffset={highlightColorStartIndex}
            editor={editor}
            resolveColorValue={resolveColorValue}
          />
        </CardItemGroup>
      </CardBody>
    </Card>
  );
}

// ─── ColorTextPopover ────────────────────────────────────────────────────────

export interface ColorTextPopoverProps
  extends Omit<React.ComponentProps<typeof Button>, "type">, UseColorTextPopoverConfig {
  resolveColorValue?: ColorValueResolver;
}

/**
 * Color text popover component for Tiptap editors.
 *
 * For custom popover implementations, use the `useColorTextPopover` hook instead.
 */
export function ColorTextPopover({
  editor: providedEditor,
  hideWhenUnavailable = false,
  onColorChanged,
  onClick,
  children,
  ref,
  resolveColorValue,
  ...buttonProps
}: ColorTextPopoverProps) {
  const { editor } = useTiptapEditor(providedEditor);
  const [isOpen, setIsOpen] = useState(false);
  const {
    isVisible,
    canToggle,
    activeTextStyle,
    activeHighlight,
    handleColorChanged,
    label,
    Icon,
  } = useColorTextPopover({ editor, hideWhenUnavailable, onColorChanged });

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      setIsOpen((prev) => !prev);
    },
    [onClick]
  );

  if (!isVisible) return null;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          data-appearance="default"
          role="button"
          aria-label={label}
          tooltip={label}
          disabled={!canToggle}
          data-disabled={!canToggle}
          onClick={handleClick}
          ref={ref}
          {...buttonProps}
        >
          {children ?? (
            <>
              <span
                className="tiptap-button-color-text-popover"
                style={
                  activeHighlight.color
                    ? ({
                        "--active-highlight-color": activeHighlight.color,
                      } as React.CSSProperties)
                    : {}
                }
              >
                <Icon
                  className="tiptap-button-icon"
                  style={{ color: activeTextStyle.color || undefined }}
                />
              </span>
              <ChevronDownIcon className="tiptap-button-dropdown-small" />
            </>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        aria-label="Text color options"
        side="bottom"
        align="start"
        collisionPadding={4}
      >
        <TextStyleColorPanel
          onColorChanged={handleColorChanged}
          editor={editor}
          resolveColorValue={resolveColorValue}
        />
      </PopoverContent>
    </Popover>
  );
}

export default ColorTextPopover;
