/**
 * SEO / GEO public surface.
 *
 * Server-only — every export under this barrel is gated by
 * `"server-only"` so a stray client import fails fast at build
 * time rather than silently shipping unused JSON-LD into the
 * client bundle.
 *
 * Usage:
 *   import { JsonLd, buildOrganization, buildArticle } from "@/src/lib/seo";
 *
 * Then in a server component:
 *   <JsonLd data={[ buildArticle(...), buildBreadcrumbList(...) ]} />
 */

export { JsonLd } from "./jsonld";
export { CANONICAL_HOST, absoluteUrl, localeCanonicalUrl, entityId, FRAGMENTS } from "./canonical";

export { buildOrganization, ORGANIZATION_ID } from "./builders/organization";
export { buildWebSite, WEBSITE_ID } from "./builders/website";
export { buildBreadcrumbList } from "./builders/breadcrumb";
export type { BreadcrumbCrumb } from "./builders/breadcrumb";
export { buildArticle } from "./builders/article";
export type { ArticleInput } from "./builders/article";
export { buildCreativeWork } from "./builders/creative-work";
export type { CreativeWorkInput } from "./builders/creative-work";
export { buildCourse } from "./builders/course";
export type { CourseInput } from "./builders/course";
export { buildFaqPage } from "./builders/faqpage";
export type { FaqEntry } from "./builders/faqpage";
export { buildPerson } from "./builders/person";
export type { PersonInput } from "./builders/person";
export { buildVideoObject } from "./builders/video-object";
export type { VideoObjectInput } from "./builders/video-object";
export { buildItemList } from "./builders/itemlist";
export type { ItemListEntry } from "./builders/itemlist";
