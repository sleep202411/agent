import { createFileRoute } from "@tanstack/react-router";
import PaymentResultPage from "@/app/[locale]/payment/result/page";

export const Route = createFileRoute("/payment/result")({
  validateSearch: (search: Record<string, unknown>) => ({
    order_id: search.order_id != null ? String(search.order_id) : undefined,
    orderNo: search.orderNo != null ? String(search.orderNo) : undefined,
  }),
  component: PaymentResultPage,
});
