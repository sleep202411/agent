import { z } from "zod";
import * as css from "css-tree";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const PARTS: Record<string, readonly string[]> = {
  start: ["panel", "eyebrow", "title", "summary", "primary", "secondary"],
  playback: ["controls", "progress", "pause", "rate"],
  choices: ["prompt", "list", "option", "index", "price"],
  pause: ["panel", "title", "summary", "primary", "secondary"],
};
const PROPERTIES = new Set([
  "opacity",
  "position",
  "overflow",
  "min-height",
  "color",
  "background",
  "background-color",
  "background-image",
  "background-size",
  "background-position",
  "background-repeat",
  "background-origin",
  "background-clip",
  "backdrop-filter",
  "border",
  "border-color",
  "border-bottom-color",
  "border-width",
  "border-style",
  "border-radius",
  "border-top",
  "border-bottom",
  "border-left",
  "border-right",
  "box-shadow",
  "text-shadow",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "text-decoration",
  "text-wrap",
  "white-space",
  "padding",
  "padding-inline",
  "padding-block",
  "padding-top",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "gap",
  "row-gap",
  "column-gap",
  "width",
  "max-width",
  "display",
  "flex-direction",
  "flex-wrap",
  "align-items",
  "justify-items",
  "justify-self",
  "justify-content",
  "grid-template-columns",
  "accent-color",
  "transition",
  "transition-property",
  "transition-duration",
  "transition-timing-function",
  "transition-delay",
]);
// Region roots expose alignment and paint only; their geometry belongs to the player.
const REGION_PROPERTIES = new Set([
  "color",
  "background",
  "background-color",
  "background-image",
  "background-size",
  "background-position",
  "background-repeat",
  "align-items",
  "justify-items",
  "text-align",
]);
const DECORATION_PROPERTIES = new Set([
  ...PROPERTIES,
  "content",
  "position",
  "inset",
  "top",
  "bottom",
  "left",
  "right",
  "height",
  "max-height",
  "opacity",
  "transform",
  "transform-origin",
  "pointer-events",
]);
const FUNCTIONS = new Set([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "oklch",
  "oklab",
  "lab",
  "lch",
  "color-mix",
  "linear-gradient",
  "radial-gradient",
  "conic-gradient",
  "repeating-linear-gradient",
  "repeating-radial-gradient",
  "min",
  "max",
  "clamp",
  "calc",
  "cubic-bezier",
  "steps",
  "repeat",
  "minmax",
  "translate",
  "translateX",
  "translateY",
  "rotate",
  "scale",
  "scaleX",
  "scaleY",
  "blur",
]);
export const EXPERIENCE_THEME_CAPABILITIES = {
  version: 1,
  selectors:
    '[data-experience-ui-region="start|playback|choices|pause"] optionally followed by [data-ui-part="part"]',
  states: ["hover", "focus-visible", "active", "disabled"],
  decoration: ["::before", "::after"],
  properties: [...PROPERTIES],
  regionProperties: [...REGION_PROPERTIES],
  decorativeProperties: [...DECORATION_PROPERTIES],
  functions: [...FUNCTIONS],
  assets: 'Reference bundled SVG with asset("id") in background/background-image.',
  responsive: "@container (max-width: Npx) or (max-height: Npx)",
  fonts: "Local/system font-family stacks. External font downloads are unavailable.",
  progress:
    "Use accent-color for the actual progress/thumb color and background-color for the actual track color. No progress decorations or fake progress widths.",
  bounds:
    "Real parts: position:relative only, opacity 0.6–1, min-height 44–128px. Fonts 12–64px; line-height 1.2–2.4; spacing 0–64px. Backdrop filter: none or blur(0–32px) only. Borders 0–8px; radius 0–48px; shadows <=64px; letter-spacing <=4px or 0.2em; grid repeat 1–12. Transitions <=500ms, paint only. Region roots: paint and alignment only. Decorations: position:absolute, pointer-events:none, empty content.",
  limits: {
    cssCharacters: 32000,
    svgCharacters: 16000,
    assets: 8,
    rules: 160,
    compiledCssCharacters: 131072,
  },
} as const;
const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_TAGS = new Set([
  "svg",
  "g",
  "defs",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "linearGradient",
  "radialGradient",
  "stop",
]);
const SVG_ATTRIBUTES = new Set([
  "xmlns",
  "viewBox",
  "width",
  "height",
  "preserveAspectRatio",
  "id",
  "d",
  "points",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "fill-rule",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "transform",
  "gradientTransform",
  "gradientUnits",
  "offset",
  "stop-color",
  "stop-opacity",
  "spreadMethod",
]);

/** Static vector images only. Reject, rather than silently remove, unsupported content. */
export function compileExperienceThemeSvg(source: string): string {
  let issues = false;
  const document = new DOMParser({
    onError: () => {
      issues = true;
    },
  }).parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  if (issues || !root || root.tagName !== "svg" || document.doctype)
    throw new Error("SVG must be well-formed static SVG without a doctype.");
  let count = 0;
  const ids = new Set<string>();
  const references: string[] = [];
  const inspect = (node: typeof root, depth: number) => {
    if (++count > 256 || depth > 16) throw new Error("SVG is too complex.");
    if (!SVG_TAGS.has(node.tagName) || node.namespaceURI !== SVG_NS)
      throw new Error(`Unsupported SVG element: ${node.tagName}.`);
    for (let i = 0; i < node.attributes.length; i++) {
      const attribute = node.attributes.item(i)!;
      if (!SVG_ATTRIBUTES.has(attribute.name) || attribute.value.length > 8000)
        throw new Error(`Unsupported SVG attribute: ${attribute.name}.`);
      if (attribute.name === "xmlns" && attribute.value !== SVG_NS)
        throw new Error("SVG namespace must be the SVG namespace.");
      if (attribute.name === "id") {
        if (!/^[a-z][a-z0-9-]{0,63}$/i.test(attribute.value) || ids.has(attribute.value))
          throw new Error("SVG IDs must be unique simple identifiers.");
        ids.add(attribute.value);
      }
      if (/url\s*\(/i.test(attribute.value)) {
        const match = /^url\(#([a-z][a-z0-9-]{0,63})\)$/i.exec(attribute.value);
        if (!match || !["fill", "stroke"].includes(attribute.name))
          throw new Error("SVG may reference only its internal paint definitions.");
        references.push(match[1]!);
      }
      if (
        /[<>]/.test(attribute.value) ||
        (attribute.name !== "xmlns" && /(?:javascript|data|https?):/i.test(attribute.value))
      )
        throw new Error("SVG must not contain external content.");
    }
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) inspect(child as typeof root, depth + 1);
      else if (child.nodeType !== 3 || child.textContent?.trim())
        throw new Error("SVG decorations may contain only static vector elements.");
    }
  };
  for (let node = document.firstChild; node; node = node.nextSibling) {
    if (node !== root && (node.nodeType !== 3 || node.textContent?.trim()))
      throw new Error("SVG must contain a single root, without processing instructions.");
  }
  inspect(root, 0);
  const box = root
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    !box ||
    box.length !== 4 ||
    box.some((n) => !Number.isFinite(n) || Math.abs(n) > 4096) ||
    box[2]! <= 0 ||
    box[3]! <= 0
  )
    throw new Error("SVG needs a bounded positive viewBox.");
  if (references.some((id) => !ids.has(id))) throw new Error("SVG paint reference does not exist.");
  return new XMLSerializer().serializeToString(root);
}

const ThemeSourceSchema = z
  .object({
    version: z.literal(1),
    name: z.string().trim().min(1).max(80),
    css: z.string().trim().min(1).max(EXPERIENCE_THEME_CAPABILITIES.limits.cssCharacters),
    assets: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
            svg: z.string().min(1).max(EXPERIENCE_THEME_CAPABILITIES.limits.svgCharacters),
          })
          .strict()
      )
      .max(EXPERIENCE_THEME_CAPABILITIES.limits.assets),
  })
  .strict();
export type ExperienceUITheme = z.infer<typeof ThemeSourceSchema>;
const compiledCache = new Map<string, string>();

function selectorInfo(selector: css.Selector): {
  region: string;
  part: string;
  decoration: boolean;
} {
  const nodes = selector.children.toArray();
  const attribute = (node: css.CssNode | undefined, name: string) => {
    if (
      node?.type !== "AttributeSelector" ||
      node.name.name !== name ||
      node.matcher !== "=" ||
      node.flags ||
      node.value?.type !== "String"
    )
      throw new Error("Use exact region and part selectors.");
    return node.value.value;
  };
  const region = attribute(nodes[0], "data-experience-ui-region");
  if (!PARTS[region]) throw new Error(`Unknown UI region: ${region}.`);
  const root = nodes[1]?.type !== "Combinator";
  if (!root && nodes[1]?.type === "Combinator" && nodes[1].name !== " ")
    throw new Error("Use a region followed by its part.");
  const part = root ? "" : attribute(nodes[2], "data-ui-part");
  if (!root && !PARTS[region]?.includes(part))
    throw new Error(`Unknown UI part: ${region}/${part}.`);
  let decoration = false;
  for (const node of nodes.slice(root ? 1 : 3)) {
    if (
      node.type === "PseudoClassSelector" &&
      !decoration &&
      !root &&
      !node.children &&
      EXPERIENCE_THEME_CAPABILITIES.states.includes(node.name as "hover")
    )
      continue;
    if (
      node.type === "PseudoElementSelector" &&
      !decoration &&
      !node.children &&
      ["before", "after"].includes(node.name)
    ) {
      decoration = true;
      continue;
    }
    throw new Error("Only interaction states and decorative ::before/::after are supported.");
  }
  if (part === "progress" && decoration)
    throw new Error(
      "Progress is runtime-owned. Use accent-color and background-color, without decorative progress layers."
    );
  return { region, part, decoration };
}

function compileSource(theme: ExperienceUITheme, scope: string): string {
  const key = JSON.stringify([scope, theme]);
  const cached = compiledCache.get(key);
  if (cached !== undefined) return cached;
  const assets = new Map<string, string>();
  for (const asset of theme.assets) {
    if (assets.has(asset.id)) throw new Error(`Duplicate asset: ${asset.id}.`);
    assets.set(
      asset.id,
      `data:image/svg+xml,${encodeURIComponent(compileExperienceThemeSvg(asset.svg))}`
    );
  }
  const ast = css.parse(theme.css, { parseCustomProperty: true });
  if (ast.type !== "StyleSheet") throw new Error("A theme must be a CSS stylesheet.");
  let rules = 0;
  let declarations = 0;
  const issues: string[] = [];
  const compile = (nodes: css.List<css.CssNode>, depth: number): string => {
    if (depth > 1) throw new Error("Nested container queries are unavailable.");
    return nodes
      .toArray()
      .map((node) => {
        if (node.type === "Atrule" && node.name === "container" && node.prelude && node.block) {
          const condition = css.generate(node.prelude);
          if (!/^\((?:max|min)-(?:width|height):\s*\d{1,4}px\)$/.test(condition))
            throw new Error("Use a simple min/max width or height container query in pixels.");
          return `@container ${condition}{${compile(node.block.children, depth + 1)}}`;
        }
        if (node.type !== "Rule" || node.prelude.type !== "SelectorList")
          throw new Error(
            "Only part rules and size container queries are supported; no imports, fonts or keyframes."
          );
        if (++rules > EXPERIENCE_THEME_CAPABILITIES.limits.rules)
          throw new Error("Too many theme rules.");
        const selectors = node.prelude.children.toArray();
        const info = selectors.map((selector) => {
          if (selector.type !== "Selector") throw new Error("Invalid part selector.");
          return selectorInfo(selector);
        });
        const decoration = info.every((item) => item.decoration);
        if (info.some((item) => item.decoration !== decoration))
          throw new Error("Keep decoration and interactive part rules separate.");
        const regionRoot = info.every((item) => item.part === "");
        if (info.some((item) => (item.part === "") !== regionRoot))
          throw new Error("Keep region roots and part rules separate.");
        const body = node.block.children
          .toArray()
          .map((declaration) => {
            try {
              if (declaration.type !== "Declaration" || declaration.important)
                throw new Error("Use normal CSS declarations without !important or nesting.");
              if (++declarations > 1024) throw new Error("Too many theme declarations.");
              const property = declaration.property;
              if (
                !(
                  decoration ? DECORATION_PROPERTIES : regionRoot ? REGION_PROPERTIES : PROPERTIES
                ).has(property)
              )
                throw new Error(`Unsupported theme property: ${property}.`);
              if (
                property === "backdrop-filter" &&
                !/^(?:none|blur\((?:\d+(?:\.\d+)?|\.\d+)px\))$/.test(
                  css.generate(declaration.value)
                )
              )
                throw new Error("Backdrop filter must be none or blur(0–32px).");
              const valueNodes =
                declaration.value.type === "Value" ? declaration.value.children.toArray() : [];
              if (
                property === "font-size" &&
                (valueNodes.length !== 1 ||
                  valueNodes[0]?.type !== "Dimension" ||
                  valueNodes[0].unit !== "px" ||
                  Number(valueNodes[0].value) < 12 ||
                  Number(valueNodes[0].value) > 64)
              )
                throw new Error(
                  "Font size must be a 12–64px value; use container queries to adapt it."
                );
              if (
                property === "line-height" &&
                (valueNodes.length !== 1 ||
                  valueNodes[0]?.type !== "Number" ||
                  Number(valueNodes[0].value) < 1.2 ||
                  Number(valueNodes[0].value) > 2.4)
              )
                throw new Error("Line height must be 1.2–2.4.");
              if (
                property === "display" &&
                (!info.every((item) => ["panel", "list"].includes(item.part)) ||
                  !["flex", "grid", "block"].includes(css.generate(declaration.value)))
              )
                throw new Error("Display can arrange panels and lists, but cannot hide content.");
              if (
                property === "position" &&
                css.generate(declaration.value) !== (decoration ? "absolute" : "relative")
              )
                throw new Error(
                  "Only decorative parts may be positioned, within their owning part."
                );
              if (property === "pointer-events" && css.generate(declaration.value) !== "none")
                throw new Error("Decorations cannot receive input.");
              if (
                property === "opacity" &&
                (valueNodes.length !== 1 ||
                  valueNodes[0]?.type !== "Number" ||
                  Number(valueNodes[0].value) < (decoration ? 0 : 0.6) ||
                  Number(valueNodes[0].value) > 1)
              )
                throw new Error("Real content opacity must be 0.6–1; decorative opacity 0–1.");
              if (
                property === "min-height" &&
                (valueNodes.length !== 1 ||
                  valueNodes[0]?.type !== "Dimension" ||
                  valueNodes[0].unit !== "px" ||
                  Number(valueNodes[0].value) < 44 ||
                  Number(valueNodes[0].value) > 128)
              )
                throw new Error("Minimum height must be 44–128px.");
              if (
                property === "overflow" &&
                !["hidden", "clip", "auto"].includes(css.generate(declaration.value))
              )
                throw new Error("Content must stay within its part.");
              if (property === "content" && css.generate(declaration.value) !== '""')
                throw new Error(
                  "Decorations must use empty content; story text stays with the runtime."
                );
              css.walk(declaration.value, {
                enter(
                  value: css.CssNode,
                  item: css.ListItem<css.CssNode> | null,
                  list: css.List<css.CssNode> | null
                ) {
                  if (value.type === "Raw" || value.type === "Url")
                    throw new Error("Use valid CSS and bundled asset(id), never resource URLs.");
                  if (value.type === "String" && /[<>]/.test(value.value))
                    throw new Error("Invalid CSS string.");
                  if (value.type === "Function") {
                    if (value.name === "blur" && property !== "backdrop-filter")
                      throw new Error("Blur is only available as a bounded backdrop filter.");
                    if (value.name === "repeat") {
                      const count = value.children.toArray()[0];
                      if (
                        count?.type !== "Number" ||
                        !Number.isInteger(Number(count.value)) ||
                        Number(count.value) < 1 ||
                        Number(count.value) > 12
                      )
                        throw new Error("Grid repeat must use 1–12 tracks.");
                    }
                    if (value.name === "asset") {
                      const args = value.children.toArray();
                      const id =
                        args.length === 1 && args[0]?.type === "String" ? args[0].value : "";
                      const uri = assets.get(id);
                      if (
                        !uri ||
                        !["background", "background-image"].includes(property) ||
                        !item ||
                        !list
                      )
                        throw new Error(`Unknown or misplaced SVG asset: ${id}.`);
                      list.replace(item, list.createItem({ type: "Url", value: uri }));
                      return css.walk.skip;
                    }
                    if (!FUNCTIONS.has(value.name))
                      throw new Error(`Unsupported CSS function: ${value.name}.`);
                  }
                  if (value.type === "Dimension") {
                    const number = Number(value.value);
                    if (
                      property === "backdrop-filter" &&
                      (value.unit !== "px" || number < 0 || number > 32)
                    )
                      throw new Error("Backdrop blur must be 0–32px.");
                    if (
                      property.startsWith("border") &&
                      (value.unit !== "px" ||
                        number < 0 ||
                        number > (property === "border-radius" ? 48 : 8))
                    )
                      throw new Error("Borders must be 0–8px and radius 0–48px.");
                    if (
                      ["box-shadow", "text-shadow"].includes(property) &&
                      (value.unit !== "px" || Math.abs(number) > 64)
                    )
                      throw new Error("Shadow dimensions must be within 64px.");
                    if (
                      property === "letter-spacing" &&
                      !(
                        (value.unit === "px" && number <= 4) ||
                        (value.unit === "em" && number <= 0.2)
                      )
                    )
                      throw new Error("Letter spacing must be 0–4px or 0–0.2em.");
                    if (
                      !Number.isFinite(number) ||
                      (number < 0 &&
                        !decoration &&
                        !["box-shadow", "text-shadow"].includes(property)) ||
                      number < -4096 ||
                      number > 4096 ||
                      !["px", "em", "rem", "cqw", "cqh", "cqmin", "deg", "ms", "s", "fr"].includes(
                        value.unit
                      )
                    )
                      throw new Error(
                        "Use bounded local dimensions, not viewport or external values."
                      );
                    if (
                      [
                        "padding",
                        "padding-inline",
                        "padding-block",
                        "padding-top",
                        "padding-bottom",
                        "padding-left",
                        "padding-right",
                        "gap",
                        "row-gap",
                        "column-gap",
                      ].includes(property) &&
                      (value.unit !== "px" || number > 64)
                    )
                      throw new Error("Spacing must be 0–64px.");
                    if (
                      property === "font-size" &&
                      (value.unit !== "px" || number < 12 || number > 64)
                    )
                      throw new Error("Font size must be 12–64px.");
                    if (
                      ["s", "ms"].includes(value.unit) &&
                      number * (value.unit === "s" ? 1000 : 1) > 500
                    )
                      throw new Error("Transitions must be at most 500ms.");
                  }
                },
              });
              const match = css.lexer.matchProperty(property, declaration.value);
              if (!match.matched)
                throw new Error(`Invalid ${property}: ${match.error?.message ?? "invalid value"}.`);
              if (
                property.startsWith("transition") &&
                /(?:\ball\b|\b(?:display|height|width|padding|gap|font|margin|position)\b)/.test(
                  css.generate(declaration.value)
                )
              )
                throw new Error("Transitions may change paint, not geometry.");
              const value = css.generate(declaration.value);
              if (
                info.every((item) => item.region === "playback" && item.part === "progress") &&
                ["accent-color", "background-color"].includes(property)
              ) {
                if (!css.lexer.matchType("color", declaration.value).matched)
                  throw new Error("Progress needs an explicit CSS color.");
                return property === "accent-color"
                  ? `accent-color:${value};--appearance-transport-progressColor:${value};--appearance-transport-watchedColor:color-mix(in srgb,${value} 40%,var(--appearance-transport-trackColor,transparent))`
                  : `--appearance-transport-trackColor:${value}`;
              }
              return `${property}:${value}`;
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              if (!issues.includes(message) && issues.length < 16) issues.push(message);
              return "";
            }
          })
          .join(";");
        const prefix = `[data-experience-theme="${scope}"]`.repeat(3);
        return `${selectors.map((selector) => `${prefix} ${css.generate(selector)}`).join(",")}{${body}}`;
      })
      .join("");
  };
  const output = compile(ast.children, 0);
  if (issues.length) throw new Error(issues.join("\n"));
  if (!rules || output.includes("<")) throw new Error("Theme must contain safe UI part rules.");
  if (output.length > 131072)
    throw new Error(
      "Compiled theme exceeds the 128KiB budget. Simplify or reuse smaller decorations."
    );
  compiledCache.set(key, output);
  if (compiledCache.size > 8) compiledCache.delete(compiledCache.keys().next().value!);
  return output;
}

export const ExperienceUIThemeSchema = ThemeSourceSchema.superRefine((theme, context) => {
  try {
    compileSource(theme, "validation");
  } catch (error) {
    context.addIssue({
      code: "custom",
      path: ["css"],
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/** Recompile at the trust boundary. Never inject unvalidated source CSS or inline SVG. */
export function compileExperienceUITheme(theme: ExperienceUITheme, scope: string): string {
  if (!/^[a-z][a-z0-9-]{0,80}$/i.test(scope)) throw new Error("Invalid theme scope.");
  return compileSource(ThemeSourceSchema.parse(theme), scope);
}
