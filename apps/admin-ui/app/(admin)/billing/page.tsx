import { redirect } from "next/navigation";

// Billing overview metrics are folded into the 套餐商品 (catalog) group, so the
// /billing index just lands on the first page of the second rail.
export default function BillingAdminPage() {
  redirect("/billing/catalog");
}
