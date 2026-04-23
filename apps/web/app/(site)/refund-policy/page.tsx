import type { Metadata } from "next";
import { headers } from "next/headers";
import { LegalDocument } from "@/app/(site)/_components/legal-document";
import { content } from "./content";

export const metadata: Metadata = {
  title: "Refund Policy — FizzDragon",
};

export default async function RefundPolicyPage() {
  const locale = (await headers()).get("x-locale") ?? "zh-CN";
  const doc = content[locale] ?? content["en-US"];
  return <LegalDocument title={doc.title} subtitle={doc.subtitle} content={doc.body} />;
}
