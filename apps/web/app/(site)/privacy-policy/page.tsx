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

// CN store scanners require the policy + first-launch consent to name purpose /
// method / scope for MAC address, installed-app list, and sensor list access
// that the mobile runtime / player stack may trigger after the user agrees.
const mobileDeviceDisclosure: Record<string, string> = {
  "zh-CN":
    "## 移动应用设备信息说明\n\n" +
    "当您使用我们的 **移动客户端（App）** 时，为保障应用正常运行、内容播放、设备兼容适配与基础统计分析，" +
    "在您通过首启弹窗同意《隐私政策》之后，应用运行环境及配套组件（含系统与第三方运行库）可能会读取或访问下列信息：\n\n" +
    "| 信息类型 | 目的 | 方式 | 范围 |\n" +
    "| --- | --- | --- | --- |\n" +
    "| **设备标识信息（含 MAC 地址）** | 设备识别与兼容适配、保障账号与服务安全 | 由应用运行环境在本地读取设备网络/标识相关信息 | 仅限本应用运行所需；不会用于与本服务无关的目的向第三方出售 |\n" +
    "| **已安装应用软件列表** | 兼容性检测、防作弊/安全风控（如适用）及运行环境判断 | 由系统接口在本地查询 | 仅在本设备本地处理或按实现需要传输至我们的服务端用于上述目的 |\n" +
    "| **设备传感器列表** | 播放、交互与界面适配（如方向/运动相关能力） | 由系统传感器框架查询可用传感器类型 | 读取传感器能力列表；不会在未说明的情况下用于与本服务无关的持续追踪 |\n\n" +
    "上述信息的收集以实现服务所必需为限。您可通过卸载应用停止相关处理。" +
    "更完整的个人信息处理规则见下文各章节。\n",
  "zh-HK":
    "## 流動應用裝置資訊說明\n\n" +
    "當您使用我們的 **流動客戶端（App）** 時，為保障應用正常運行、內容播放、裝置兼容適配與基礎統計分析，" +
    "在您透過首啟彈窗同意《私隱政策》之後，應用運行環境及配套組件（含系統與第三方運行庫）可能會讀取或存取下列資訊：\n\n" +
    "| 資訊類型 | 目的 | 方式 | 範圍 |\n" +
    "| --- | --- | --- | --- |\n" +
    "| **裝置標識資訊（含 MAC 地址）** | 裝置識別與兼容適配、保障帳號與服務安全 | 由應用運行環境在本地讀取裝置網絡/標識相關資訊 | 僅限本應用運行所需；不會用於與本服務無關的目的向第三方出售 |\n" +
    "| **已安裝應用軟件列表** | 兼容性檢測、防作弊/安全風控（如適用）及運行環境判斷 | 由系統介面在本地查詢 | 僅在本裝置本地處理或按實現需要傳輸至我們的服務端用於上述目的 |\n" +
    "| **裝置傳感器列表** | 播放、互動與介面適配（如方向/運動相關能力） | 由系統傳感器框架查詢可用傳感器類型 | 讀取傳感器能力列表；不會在未說明的情況下用於與本服務無關的持續追蹤 |\n\n" +
    "上述資訊的收集以實現服務所必需為限。您可透過卸載應用停止相關處理。" +
    "更完整的個人資訊處理規則見下文各章節。\n",
  "en-US":
    "## Mobile App Device Information\n\n" +
    "When you use our **mobile client (App)**, after you agree to this Privacy Policy via the first-launch consent dialog, " +
    "the app runtime and related components (including system and third-party libraries) may access the following information " +
    "to keep the app running, play content, adapt to your device, and perform basic analytics:\n\n" +
    "| Type | Purpose | Method | Scope |\n" +
    "| --- | --- | --- | --- |\n" +
    "| **Device identifiers (including MAC address)** | Device recognition, compatibility, account/service security | Read locally by the app runtime | Limited to operating this App; not sold to third parties for unrelated purposes |\n" +
    "| **Installed application list** | Compatibility checks, security/fraud prevention (where applicable), runtime environment | Queried locally via system APIs | Processed on-device or sent to our servers only for the purposes above |\n" +
    "| **Device sensor list** | Playback, interaction, and UI adaptation (e.g. orientation/motion) | Queried via the system sensor framework | Sensor capability list only; not used for undisclosed continuous tracking |\n\n" +
    "Collection is limited to what is necessary to provide the Service. Uninstalling the App stops related processing. " +
    "Further details appear in the sections below.\n",
};

export default async function PrivacyPolicyPage() {
  const locale = (await headers()).get("x-locale") ?? "en-US";
  const doc = content[locale] ?? content["en-US"];
  // CN/HK app stores require the policy to name the operator, ICP filing, and
  // contact. Show it on the CN site AND always on the Chinese-language policies
  // (what a CN-store reviewer reads) so the requirement doesn't silently depend
  // on SITE_REGION being set on that deployment.
  const showOperator = siteConfig.region === "cn" || locale === "zh-CN" || locale === "zh-HK";
  const parts: string[] = [];
  if (showOperator) {
    parts.push(operatorInfo[locale] ?? operatorInfo["zh-CN"]);
    parts.push(mobileDeviceDisclosure[locale] ?? mobileDeviceDisclosure["zh-CN"]);
  }
  parts.push(doc.body);
  const body = parts.join("\n");
  return <LegalDocument title={doc.title} subtitle={doc.subtitle} content={body} />;
}
