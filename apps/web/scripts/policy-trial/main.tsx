import { createRoot } from "react-dom/client";
import CrewPolicyTrial from "../../app/(site)/crews/policy-trial/page";
import i18n from "../../src/i18n/i18n";
import { isValidLocale } from "../../src/i18n/config";
import "../../app/globals.css";

const requested = new URLSearchParams(window.location.search).get("lang");
const locale = requested && isValidLocale(requested) ? requested : "zh-CN";
await i18n.changeLanguage(locale);
document.documentElement.lang = locale;
createRoot(document.getElementById("root")!).render(<CrewPolicyTrial />);
