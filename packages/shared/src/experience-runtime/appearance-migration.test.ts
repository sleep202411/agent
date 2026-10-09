import { expect, it } from "vitest";
import { ExperienceAppearanceSchema } from "./appearance";
import { migrateStoredExperienceAppearance } from "./appearance-migration";
import { compileExperienceUITheme, ExperienceUIThemeSchema } from "./ui-theme";
const legacy = { choices: "glass", transport: "glass", layout: "row", size: 1, accent: "#e52227" };
const surface = {
  background: "#111111",
  color: "#eeeeee",
  borderColor: "#777777",
  borderWidth: 1,
  radius: 8,
  paddingX: 64,
  paddingY: 40,
  fontSize: 20,
  fontWeight: 500,
  blur: 32,
};
const theme = {
  version: 1,
  name: "Palace",
  css: '[data-experience-ui-region="choices"] [data-ui-part="option"]{color:#d6b77a}',
  assets: [
    {
      id: "line",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>',
    },
  ],
};
it("imports native defaults without manufacturing a theme and rejects legacy fields in new input", () => {
  expect(migrateStoredExperienceAppearance(legacy)).toEqual({ version: 1 });
  expect(ExperienceAppearanceSchema.safeParse(legacy).success).toBe(false);
  expect(ExperienceAppearanceSchema.safeParse({ version: 1, layout: "column" }).success).toBe(
    false
  );
  expect(() => migrateStoredExperienceAppearance({ version: 99 })).toThrow();
});
it("preserves legacy region geometry, localized copy, assets and CSS priority in one validated bundle", () => {
  const menu = {
    ...surface,
    overlay: "rgba(0,0,0,0.4)",
    position: "right",
    width: 720,
    titleSize: 64,
    gap: 40,
    button: { ...surface, hoverBackground: "#333333", hoverColor: "#ffffff" },
  };
  const imported = migrateStoredExperienceAppearance({
    ...legacy,
    choices: "paper",
    layout: "column",
    presentation: {
      copy: { start: { "zh-CN": "Enter" } },
      theme,
      start: menu,
      pause: menu,
      choices: {
        ...surface,
        layout: "column",
        position: "top",
        width: 640,
        gap: 48,
        hoverBackground: "#333333",
        hoverColor: "#ffffff",
      },
      transport: { ...surface, progressColor: "#d6b77a", trackColor: "#222222" },
    },
  });
  expect(Object.keys(imported)).toEqual(["version", "presentation"]);
  expect(Object.keys(imported.presentation!)).toEqual(["copy", "theme"]);
  expect(imported.presentation?.copy?.start["zh-CN"]).toBe("Enter");
  expect(imported.presentation?.theme?.assets).toEqual(theme.assets);
  const css = compileExperienceUITheme(imported.presentation!.theme!, "import");
  expect(css).toContain("justify-items:end");
  expect(css).toContain("align-items:start");
  expect(css).toContain("backdrop-filter:blur(32px)");
  expect(css).toContain("flex-direction:column");
  expect(css.lastIndexOf("color:#d6b77a")).toBeGreaterThan(css.indexOf("color:#eee"));
  expect(migrateStoredExperienceAppearance(imported)).toEqual(imported);
});
it.each(["glass", "paper", "minimal"])(
  "imports a modified %s preset as CSS, without live preset parameters",
  (skin) => {
    const value = migrateStoredExperienceAppearance({
      ...legacy,
      choices: skin,
      transport: skin,
      layout: "column",
    });
    expect(value.presentation?.theme?.css).toContain("flex-direction:column");
    expect(ExperienceAppearanceSchema.safeParse(value).success).toBe(true);
  }
);
it("exposes root alignment and bounded glass effects without opening host geometry or hiding controls", () => {
  const parse = (css: string) => ExperienceUIThemeSchema.safeParse({ ...theme, css }).success;
  expect(
    parse(
      '[data-experience-ui-region="start"]{justify-items:end}[data-experience-ui-region="choices"]{align-items:center}'
    )
  ).toBe(true);
  for (const css of [
    '[data-experience-ui-region="start"]{position:fixed}',
    '[data-experience-ui-region="choices"]{display:none}',
    '[data-experience-ui-region="start"]{width:0}',
    '[data-experience-ui-region="start"] [data-ui-part="panel"]{backdrop-filter:blur(33px)}',
    '[data-experience-ui-region="start"] [data-ui-part="panel"]{backdrop-filter:brightness(0)}',
    '[data-experience-ui-region="missing"]{color:red}',
  ])
    expect(parse(css)).toBe(false);
});

it("preserves an authored accent in CSS without a global color parameter", () => {
  const imported = migrateStoredExperienceAppearance({ ...legacy, accent: "#abcdef" });
  expect(imported.presentation?.theme?.css).toContain(
    '[data-experience-ui-region="start"] [data-ui-part="primary"]{background:#abcdef;}'
  );
  expect(imported).not.toHaveProperty("accent");
});
