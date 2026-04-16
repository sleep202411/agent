import { createFileRoute } from "@tanstack/react-router";
import NewsPage from "@/app/[locale]/(public)/news/page";

export const Route = createFileRoute("/news")({
  component: NewsPage,
});
