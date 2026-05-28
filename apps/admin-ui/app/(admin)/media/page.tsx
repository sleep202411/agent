import { ModulePlaceholder } from "@/components/admin/module-placeholder";

export default function MediaAdminPage() {
  return (
    <ModulePlaceholder
      title="媒体资产"
      description="统一管理证书图片、IP 封面、视频资产、上传失败和跨云存储引用。"
      items={[
        "媒体资产检索、来源、存储 provider 和对象路径",
        "图片、视频、音频、证书等不同资产类型",
        "上传失败重试、资产可见性和引用关系",
        "未来接入图库、项目资产和内容分发状态",
      ]}
    />
  );
}
