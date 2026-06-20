import { redirect } from "next/navigation";

// 增长运营 has no standalone overview; the /growth index lands on the first page
// of the second rail (促销优惠).
export default function GrowthAdminPage() {
  redirect("/growth/promotions");
}
