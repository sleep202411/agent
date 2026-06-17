import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * Locale-aware navigation. Use these in place of next/link and next/navigation
 * for app routes — they keep the active locale prefix on the URL automatically.
 * (useSearchParams / useParams / notFound still come from next/navigation.)
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
