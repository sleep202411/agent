import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getStudioHref } from "@/src/lib/region/cell";

/** The canonical compute-membership catalog and checkout live in Studio. */
export default async function MembershipPage() {
  const locale = (await headers()).get("x-locale") ?? "en-US";
  redirect(`${getStudioHref(locale)}#settings/billing`);
}
