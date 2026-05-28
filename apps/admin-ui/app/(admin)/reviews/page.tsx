import { ModulePlaceholder } from "@/components/admin/module-placeholder";

export default function ReviewsAdminPage() {
  return (
    <ModulePlaceholder
      title="审核队列"
      description="承接 IP 发布审核、举报处理、屏蔽恢复、版权材料复核等运营工作。"
      items={[
        "待审核、审核中、需修改、已通过、已驳回队列",
        "举报证据、处置原因和操作人审计",
        "内容恢复、区域屏蔽、暂停销售等动作",
        "高风险内容的二次确认和批注记录",
      ]}
    />
  );
}
