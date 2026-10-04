import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import CourseDetailPage, { generateMetadata } from "./page";
const state = vi.hoisted(() => ({ locale: "en-US", read: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-locale": state.locale }) }));
vi.mock("@/src/lib/seo/public-content", () => ({ readPublicCourse: state.read }));
vi.mock("./course-detail-client", () => ({
  default: ({ preview }: { preview: React.ReactNode }) => <main>{preview}</main>,
}));
beforeEach(() => {
  state.read.mockResolvedValue({
    id: 1,
    title: "Film </script> course",
    description: "Learn production",
  });
});
it.each(["en-US", "zh-CN", "zh-HK"])(
  "renders public course copy/schema and metadata for %s without playback credentials",
  async (locale) => {
    state.locale = locale;
    const props = { params: Promise.resolve({ id: "1" }) };
    const html = renderToStaticMarkup(await CourseDetailPage(props));
    expect(html).toContain("<h1");
    expect(html).toContain("Learn production");
    expect(html).toContain('"@type":"Course"');
    expect(html).not.toContain("Film </script>");
    expect(html).not.toContain('"offers"');
    const metadata = await generateMetadata(props);
    expect(metadata.alternates?.canonical).toBe(`https://fizzdragon.com/${locale}/courses/1`);
    expect(state.read).toHaveBeenCalledWith("1", locale);
  }
);
it("keeps the interactive recovery page when public metadata is unavailable", async () => {
  state.read.mockResolvedValue(null);
  const props = { params: Promise.resolve({ id: "1" }) };
  expect(renderToStaticMarkup(await CourseDetailPage(props))).toBe("<main></main>");
  expect(await generateMetadata(props)).toEqual({});
});
