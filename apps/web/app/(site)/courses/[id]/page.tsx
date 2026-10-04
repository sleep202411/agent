import { cache } from "react";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { locales, defaultLocale } from "@/src/i18n/config";
import { JsonLd, buildCourse, localeCanonicalUrl } from "@/src/lib/seo";
import { readPublicCourse } from "@/src/lib/seo/public-content";
import CourseDetailClient from "./course-detail-client";

const courseForRequest = cache(readPublicCourse);
async function requestLocale() {
  const locale = (await headers()).get("x-locale");
  return locales.find((value) => value === locale) ?? defaultLocale;
}
type Props = { params: Promise<{ id: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const locale = await requestLocale();
  const course = await courseForRequest(id, locale);
  if (!course) return {};
  return {
    title: course.title,
    description: course.description,
    alternates: { canonical: localeCanonicalUrl(`/courses/${course.id}`, locale) },
    openGraph: { title: course.title, description: course.description, type: "website" },
  };
}
export default async function CourseDetailPage({ params }: Props) {
  const { id } = await params;
  const locale = await requestLocale();
  const course = await courseForRequest(id, locale);
  return (
    <>
      {course && (
        <JsonLd
          data={buildCourse({
            url: localeCanonicalUrl(`/courses/${course.id}`, locale),
            inLanguage: locale,
            name: course.title,
            description: course.description,
          })}
        />
      )}
      <CourseDetailClient
        preview={
          course ? (
            <section className="w-full px-6 py-8">
              <h1 className="text-2xl font-semibold">{course.title}</h1>
              <p className="mt-3 whitespace-pre-line text-sm text-white/70">{course.description}</p>
            </section>
          ) : undefined
        }
      />
    </>
  );
}
