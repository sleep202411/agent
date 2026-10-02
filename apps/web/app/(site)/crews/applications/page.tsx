"use client";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "@/src/i18n/i18n";
export default function MyApplicationsPage() {
  const router = useRouter();
  const locale = useLocale();
  const params = useSearchParams();
  useEffect(() => {
    const query = new URLSearchParams(params.toString());
    query.set("tab", "recruitment");
    router.replace(`/${locale}/messages?${query}`);
  }, [locale, params, router]);
  return null;
}
