import { z } from "zod";
import { ExperienceUICopySchema } from "./ui.js";
import { ExperienceUIThemeSchema } from "./ui-theme.js";
import { ExperienceAppearanceSchema, type ExperienceAppearance } from "./appearance.js";

// Storage ingress only. Player rendering and new inputs accept only the canonical contract.
const color = z
  .string()
  .max(80)
  .regex(
    /^(#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\(\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)|transparent)$/i
  )
  .refine((value) => {
    value = value.toLowerCase();
    if (!value.startsWith("rgb")) return true;
    const channels = value
      .slice(value.indexOf("(") + 1, -1)
      .split(",")
      .map(Number);
    return (
      channels.length === (value.startsWith("rgba") ? 4 : 3) &&
      channels.slice(0, 3).every((channel) => channel <= 255) &&
      (channels[3] === undefined || channels[3] <= 1)
    );
  }, "Use a valid hex, rgb, rgba or transparent color.");
const surface = z
  .object({
    background: color,
    color,
    borderColor: color,
    borderWidth: z.number().min(0).max(8),
    radius: z.number().min(0).max(48),
    paddingX: z.number().min(8).max(64),
    paddingY: z.number().min(8).max(40),
    fontSize: z.number().min(12).max(40),
    fontWeight: z.number().int().min(300).max(800),
    blur: z.number().min(0).max(32),
  })
  .strict();

const menuSurface = surface
  .extend({
    overlay: color,
    position: z.enum(["left", "center", "right"]),
    width: z.number().min(240).max(720),
    titleSize: z.number().min(18).max(64),
    gap: z.number().min(8).max(40),
    button: surface.extend({ hoverBackground: color, hoverColor: color }).strict(),
  })
  .strict();

const LegacyPresentationSchema = z
  .object({
    copy: ExperienceUICopySchema.optional(),
    theme: ExperienceUIThemeSchema.optional(),
    start: menuSurface.optional(),
    pause: menuSurface.optional(),
    choices: surface
      .extend({
        layout: z.enum(["row", "column"]),
        position: z.enum(["bottom", "center", "top"]),
        gap: z.number().min(4).max(48),
        width: z.number().min(160).max(640),
        hoverBackground: color,
        hoverColor: color,
      })
      .strict()
      .optional(),
    transport: surface.extend({ progressColor: color, trackColor: color }).strict().optional(),
  })
  .strict();
const LegacyAppearanceSchema = z
  .object({
    choices: z.enum(["glass", "paper", "minimal"]),
    transport: z.enum(["glass", "paper", "minimal"]),
    layout: z.enum(["row", "column"]),
    size: z.number().min(0.85).max(1.2),
    accent: z.string().regex(/^#[\da-f]{6}$/i),
    position: z.enum(["bottom", "center"]).optional(),
    presentation: LegacyPresentationSchema.optional(),
  })
  .strict();

const region = (name: string) => `[data-experience-ui-region="${name}"]`;
const part = (name: string, target: string) => `${region(name)} [data-ui-part="${target}"]`;
type Surface = z.infer<typeof surface>;
function surfaceCss(value: Surface): string {
  return `background:${value.background};color:${value.color};border:${value.borderWidth}px solid ${value.borderColor};border-radius:${value.radius}px;padding:${value.paddingY}px ${value.paddingX}px;font-size:${value.fontSize}px;font-weight:${value.fontWeight};backdrop-filter:blur(${value.blur}px);`;
}

/** Convert saved pre-contract styles once, in their original precedence order. */
export function migrateStoredExperienceAppearance(value: unknown): ExperienceAppearance {
  if (value && typeof value === "object" && "version" in value)
    return ExperienceAppearanceSchema.parse(value);
  const old = LegacyAppearanceSchema.parse(value);
  const presentation = old.presentation;
  const css: string[] = [];
  const rule = (selector: string, declarations: string) => css.push(`${selector}{${declarations}}`);
  const earlyChanged =
    old.choices !== "glass" ||
    old.transport !== "glass" ||
    old.layout !== "row" ||
    old.size !== 1 ||
    old.accent.toLowerCase() !== "#e52227" ||
    old.position;
  if (earlyChanged) {
    if (old.accent.toLowerCase() !== "#e52227")
      rule(part("start", "primary"), `background:${old.accent};`);
    rule(
      part("choices", "list"),
      `display:flex;flex-direction:${old.layout};flex-wrap:wrap;align-items:stretch;`
    );
    rule(
      part("choices", "option"),
      `font-size:${18 * old.size}px;${old.layout === "column" ? "width:100%;" : ""}`
    );
    if (!presentation?.choices && old.choices === "paper") {
      rule(
        part("choices", "option"),
        "background:#e7deca;color:#403d35;border-radius:4px;box-shadow:0 6px 22px rgb(0 0 0 / 0.16);backdrop-filter:none;"
      );
      rule(
        part("choices", "index"),
        "color:#6c6556;background:transparent;border-color:rgb(70 64 49 / 0.16);"
      );
    } else if (!presentation?.choices && old.choices === "minimal") {
      rule(
        part("choices", "option"),
        "background:transparent;border-color:transparent;border-bottom-color:rgb(255 255 255 / 0.48);border-radius:0;box-shadow:none;backdrop-filter:none;"
      );
      rule(part("choices", "index"), "background:transparent;border-color:transparent;");
    }
    if (!presentation?.transport) {
      const paint =
        old.transport === "paper"
          ? "background:rgb(48 43 34 / 0.94);border-radius:4px;"
          : old.transport === "glass"
            ? "background:rgb(20 20 20 / 0.48);backdrop-filter:blur(18px);border-radius:12px;"
            : "background:transparent;";
      rule(part("playback", "controls"), paint);
    }
  }
  const choices = presentation?.choices;
  const position = choices?.position ?? old.position;
  if (position)
    rule(
      region("choices"),
      `align-items:${position === "top" ? "start" : position === "center" ? "center" : "end"};`
    );
  if (choices) {
    rule(
      part("choices", "list"),
      `display:flex;flex-direction:${choices.layout};flex-wrap:${choices.layout === "column" ? "nowrap" : "wrap"};gap:${choices.gap}px;align-items:stretch;`
    );
    // Grid tracks adapt naturally; width stays local to the actual player frame.
    if (choices.layout === "column")
      rule(part("choices", "list"), `width:min(100%,${choices.width}px);justify-self:center;`);
    rule(
      part("choices", "option"),
      `${surfaceCss(choices)}width:${choices.layout === "column" ? "100%" : `min(100%,${choices.width}px)`};`
    );
    rule(
      `${part("choices", "option")}:hover`,
      `background:${choices.hoverBackground};color:${choices.hoverColor};`
    );
    rule(
      part("choices", "index"),
      "color:inherit;background:transparent;border-color:currentColor;"
    );
  }
  const transport = presentation?.transport;
  if (transport) {
    rule(part("playback", "controls"), surfaceCss(transport));
    rule(
      part("playback", "progress"),
      `accent-color:${transport.progressColor};background-color:${transport.trackColor};`
    );
    rule(
      `${part("playback", "pause")},${part("playback", "rate")}`,
      `color:inherit;font-size:${transport.fontSize}px;font-weight:inherit;`
    );
  }
  for (const name of ["start", "pause"] as const) {
    const menu = presentation?.[name];
    if (!menu) continue;
    const align = menu.position === "left" ? "start" : menu.position === "right" ? "end" : "center";
    rule(region(name), `justify-items:${align};text-align:${menu.position};`);
    if (name === "start") {
      rule(region(name), "background:transparent;");
      rule(
        `${region(name)}::before`,
        `content:"";position:absolute;inset:0;background:${menu.overlay};`
      );
    } else rule(region(name), `background:${menu.overlay};`);
    rule(
      part(name, "panel"),
      `${surfaceCss(menu)}display:flex;flex-direction:column;align-items:stretch;width:min(100%,${menu.width}px);gap:${menu.gap}px;`
    );
    rule(part(name, "title"), `color:inherit;font-size:${menu.titleSize}px;`);
    rule(part(name, "summary"), `color:inherit;font-size:${menu.fontSize}px;`);
    if (name === "start") rule(part(name, "eyebrow"), "color:inherit;opacity:0.65;");
    rule(`${part(name, "primary")},${part(name, "secondary")}`, surfaceCss(menu.button));
    rule(
      `${part(name, "primary")}:hover`,
      `background:${menu.button.hoverBackground};color:${menu.button.hoverColor};`
    );
    rule(part(name, "secondary"), `background:transparent;color:${menu.color};`);
  }
  // Existing CSS was the top layer. Append it last, preserving SVG assets and name.
  const theme = presentation?.theme;
  if (theme) css.push(theme.css);
  const result = {
    version: 1 as const,
    ...(css.length || presentation?.copy
      ? {
          presentation: {
            ...(presentation?.copy ? { copy: presentation.copy } : {}),
            ...(css.length
              ? {
                  theme: {
                    version: 1 as const,
                    name: theme?.name ?? "Imported theme",
                    css: css.join("\n"),
                    assets: theme?.assets ?? [],
                  },
                }
              : {}),
          },
        }
      : {}),
  };
  return ExperienceAppearanceSchema.parse(result);
}
