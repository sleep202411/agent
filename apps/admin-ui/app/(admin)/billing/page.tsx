import { ModulePlaceholder } from "@/components/admin/module-placeholder";

export default function BillingAdminPage() {
  return (
    <ModulePlaceholder
      title="订单积分"
      description="查看社区积分充值、内容购买、余额扣减、退款补偿和钱包流水。"
      items={[
        "社区积分充值订单和支付状态",
        "内容购买订单、权益解锁和退款链路",
        "钱包余额、冻结金额、流水对账",
        "手动调账必须要求双人复核和审计理由",
      ]}
    />
  );
}
