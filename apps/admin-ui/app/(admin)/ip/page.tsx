import { ModulePlaceholder } from "@/components/admin/module-placeholder";

export default function IpAdminPage() {
  return (
    <ModulePlaceholder
      title="IP 内容"
      description="管理 IP 标题、剧集、预售活动、价格规则、版权声明和上下架状态。"
      items={[
        "IP 标题列表、状态筛选、版本冲突保护",
        "剧集价格、打包价、早鸟价和解锁时间",
        "版权声明、AI 生成声明、年龄分级和内容风险标记",
        "上架、隐藏、暂停销售、排期发布的操作闭环",
      ]}
    />
  );
}
