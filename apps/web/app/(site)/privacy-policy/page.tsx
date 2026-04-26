import type { Metadata } from "next";
import { headers } from "next/headers";
import { LegalDocument } from "@/app/(site)/_components/legal-document";
import { content } from "./content";

export const metadata: Metadata = {
  title: "Privacy Policy — FizzDragon",
};

export default async function PrivacyPolicyPage() {
  const locale = (await headers()).get("x-locale") ?? "en-US";
  const doc = content[locale] ?? content["en-US"];
  return <LegalDocument title={doc.title} subtitle={doc.subtitle} content={doc.body} />;
}
