import { describe, expect, it } from "vitest";
import {
  compileExperienceUITheme,
  ExperienceUIThemeSchema,
  compileExperienceThemeSvg,
} from "./ui-theme";

const selector = '[data-experience-ui-region="choices"] [data-ui-part="option"]';
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><defs><linearGradient id="gold"><stop offset="0" stop-color="#d8bb79"/><stop offset="1" stop-color="#8c6939"/></linearGradient></defs><path d="M2 20 L20 2 L80 2 L98 20 L80 38 L20 38 Z" fill="none" stroke="url(#gold)"/></svg>';
const theme = (source: string) => ({
  version: 1 as const,
  name: "Palace",
  css: source,
  assets: [{ id: "frame", svg }],
});

describe("player theme trust boundary", () => {
  it("reports multiple CSS issues together and themes the runtime-owned progress without drawing another bar", () => {
    const rejected = ExperienceUIThemeSchema.safeParse(
      theme(`${selector}{position:fixed;pointer-events:none;color:var(--primary)}`)
    );
    expect(rejected.success).toBe(false);
    expect(rejected.error?.message).toContain("positioned");
    expect(rejected.error?.message).toContain("pointer-events");
    expect(rejected.error?.message).toContain("var");
    const progress = '[data-experience-ui-region="playback"] [data-ui-part="progress"]';
    const compiled = compileExperienceUITheme(
      theme(`${progress}{accent-color:#d6b77a;background-color:#172b29}`),
      "progress"
    );
    expect(compiled).toContain("--appearance-transport-progressColor:#d6b77a");
    expect(compiled).toContain("--appearance-transport-trackColor:#172b29");
    expect(
      ExperienceUIThemeSchema.safeParse(theme(`${progress}::before{content:""}`)).success
    ).toBe(false);
    expect(
      ExperienceUIThemeSchema.safeParse(
        theme(`${selector}{position:relative;opacity:0.8;min-height:48px;overflow:hidden}`)
      ).success
    ).toBe(true);
  });
  it("compiles real CSS and static SVG, with independent scopes and responsive states", () => {
    const source = `${selector}{color:#ead2a0;background:linear-gradient(135deg,#28231c,#12100d);font-family:Georgia,"Songti SC",serif;border:1px solid #ac8b4e;transition:background-color 180ms ease}
      ${selector}:hover{color:#fff2c8}
      ${selector}::before{content:"";position:absolute;inset:0;background-image:asset("frame");background-size:100% 100%;opacity:0.7}
      @container (max-width:480px){${selector}{font-size:14px;padding:8px 12px}}`;
    const parsed = ExperienceUIThemeSchema.safeParse(theme(source));
    expect(parsed.error).toBeUndefined();
    const result = compileExperienceUITheme(theme(source), "test-one");
    expect(result).toContain('[data-experience-theme="test-one"]');
    expect(result).toContain("data:image/svg+xml,");
    expect(result).not.toContain("asset(");
    expect(result).toContain("@container");
    expect(result).not.toContain("<svg");
    expect(compileExperienceUITheme(theme(source), "test-two")).not.toContain("test-one");
  });

  it.each([
    "body{color:red}",
    `${selector},body{color:red}`,
    `${selector} + iframe{color:red}`,
    `${selector}:has(img){color:red}`,
    '[data-experience-ui-region="start"] [data-ui-part="price"]{color:red}',
    '[data-experience-ui-region="start"] [data-ui-part="secondary"]{color:red}',
    `${selector}{background:url(https://evil.invalid/image)}`,
    `${selector}{background:u\\72l(https://evil.invalid/image)}`,
    `${selector}{background:image-set("https://evil.invalid/image")}`,
    `${selector}{background:asset("missing")}`,
    `${selector}{display:none}`,
    `${selector}{position:fixed}`,
    `${selector}{pointer-events:none}`,
    `${selector}{opacity:0}`,
    `${selector}{transform:scale(0)}`,
    `${selector}{color:red!important}`,
    `${selector}{font-size:100px}`,
    `${selector}{font-size:0}`,
    `${selector}{font-size:1%}`,
    `${selector}{line-height:0}`,
    `${selector}{padding:100px}`,
    `${selector}{border:1000px solid black}`,
    `${selector}{border-radius:999px}`,
    `${selector}{box-shadow:0 0 1000px black}`,
    `${selector}{letter-spacing:100px}`,
    '[data-experience-ui-region="choices"] [data-ui-part="list"]{grid-template-columns:repeat(1000,1fr)}',
    '[data-experience-ui-region="choices"] [data-ui-part="list"]{grid-template-columns:repeat(auto-fill,1fr)}',
    `${selector}{width:100vw}`,
    `${selector}{color:var(--primary)}`,
    `${selector}{--primary:red}`,
    `${selector}{transition:all 2s}`,
    `${selector}{color:}`,
    `${selector}::before{content:"</style><script>"}`,
    '@import "https://evil.invalid/theme.css";',
    "@font-face{font-family:test;src:url(https://evil.invalid/font)}",
    "@keyframes spin{to{transform:rotate(360deg)}}",
  ])("rejects unsafe or unsupported CSS: %s", (source) => {
    expect(ExperienceUIThemeSchema.safeParse(theme(source)).success).toBe(false);
  });

  it.each([
    "<script>alert(1)</script>",
    '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">text</div></foreignObject>',
    '<image href="https://evil.invalid/image"/>',
    '<use href="#anything"/>',
    '<animate attributeName="x" values="0;100"/>',
    '<path onload="alert(1)" d="M0 0"/>',
    '<path style="fill:red" d="M0 0"/>',
    '<path fill="url(https://evil.invalid/image)" d="M0 0"/>',
    '<path fill="url(#missing)" d="M0 0"/>',
    '<path xmlns="http://www.w3.org/1999/xhtml" d="M0 0"/>',
    '<g id="same"/><g id="same"/>',
    "<text>Replace story label</text>",
    "<!-- unexpected markup -->",
  ])("rejects non-static or external SVG: %s", (body) => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${body}</svg>`;
    expect(() => compileExperienceThemeSvg(source)).toThrow();
  });

  it("rejects malformed XML, doctypes, processing instructions, oversized and duplicate resources", () => {
    expect(() => compileExperienceThemeSvg(svg.replace("</svg>", ""))).toThrow();
    expect(() => compileExperienceThemeSvg(`<!DOCTYPE svg>${svg}`)).toThrow();
    expect(() => compileExperienceThemeSvg(`<?xml version="1.0"?>${svg}`)).toThrow();
    expect(() => compileExperienceUITheme(theme(`${selector}{color:red}`), 'bad"] body')).toThrow();
    expect(
      ExperienceUIThemeSchema.safeParse({
        ...theme(`${selector}{color:red}`),
        assets: [
          { id: "frame", svg },
          { id: "frame", svg },
        ],
      }).success
    ).toBe(false);
    expect(ExperienceUIThemeSchema.safeParse(theme(" ".repeat(24001))).success).toBe(false);
    expect(
      ExperienceUIThemeSchema.safeParse({ ...theme(`${selector}{color:red}`), version: 2 }).success
    ).toBe(false);
  });
});
