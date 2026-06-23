import type { Metadata } from "next";
import { headers } from "next/headers";
import { LegalDocument } from "@/app/(site)/_components/legal-document";
import { siteConfig } from "@/src/config/site";
import { content } from "./content";

export const metadata: Metadata = {
  title: "Privacy Policy — FizzDragon",
};

// CN app stores (小米 / 华为) require the privacy policy itself to name the
// operating entity, ICP filing, and contact. Region-gated (siteConfig.region) so
// the international (.com) site is unaffected; localized to the active locale.
const operatorInfo: Record<string, string> = {
  "zh-CN":
    "## 开发者与运营者信息\n\n" +
    "- **开发者 / 运营者**：沸腾繁星（苏州）数字科技有限公司（Fizz 共创平台）\n" +
    "- **ICP 备案号**：[苏ICP备2025193486号-1](https://beian.miit.gov.cn/)\n" +
    "- **联系邮箱**：[business@fizzdragon.com](mailto:business@fizzdragon.com)\n",
  "zh-HK":
    "## 開發者與營運者資訊\n\n" +
    "- **開發者 / 營運者**：沸騰繁星（蘇州）數字科技有限公司（Fizz 共創平台）\n" +
    "- **ICP 備案號**：[苏ICP备2025193486号-1](https://beian.miit.gov.cn/)\n" +
    "- **聯絡郵箱**：[business@fizzdragon.com](mailto:business@fizzdragon.com)\n",
  "en-US":
    "## Developer & Operator\n\n" +
    "- **Developer / Operator**: Fervent Star (Suzhou) Digital Technology Co., Ltd. (Fizz共创平台)\n" +
    "- **ICP Filing**: 苏ICP备2025193486号-1\n" +
    "- **Contact**: [business@fizzdragon.com](mailto:business@fizzdragon.com)\n",
};

export default async function PrivacyPolicyPage() {
  const locale = (await headers()).get("x-locale") ?? "en-US";
  const doc = content[locale] ?? content["en-US"];
  // CN/HK app stores require the policy to name the operator, ICP filing, and
  // contact. Show it on the CN site AND always on the Chinese-language policies
  // (what a CN-store reviewer reads) so the requirement doesn't silently depend
  // on SITE_REGION being set on that deployment.
  const showOperator = siteConfig.region === "cn" || locale === "zh-CN" || locale === "zh-HK";
  const body = showOperator
    ? `${operatorInfo[locale] ?? operatorInfo["zh-CN"]}\n${doc.body}`
    : doc.body;
  return <LegalDocument title={doc.title} subtitle={doc.subtitle} content={body} />;
}
