import { IconLayoutCards, IconPhoto, IconPlayerPlay, IconStar } from "@tabler/icons-react";
import { PageHeader, StatusPill } from "./shared";

const placements = [
  {
    key: "hero",
    title: "IP 广场 Hero",
    owner: "内容运营",
    status: "待接入",
    description: "支持独立标题、短文案、封面、视频、目标 IP、排序、上下线时间和站点维度。",
    icon: IconStar,
  },
  {
    key: "for_you",
    title: "For You 推荐",
    owner: "增长运营",
    status: "待接入",
    description: "按运营策略选择 IP 或专题素材，未来可叠加人群、语言和实验配置。",
    icon: IconLayoutCards,
  },
  {
    key: "media",
    title: "运营素材",
    owner: "设计运营",
    status: "待接入",
    description: "运营位可绑定独立图片或视频，不直接复用 IP 封面，避免影响公开详情页资产。",
    icon: IconPhoto,
  },
  {
    key: "preview",
    title: "视频预览",
    owner: "内容运营",
    status: "待接入",
    description: "为首屏视频、试看片段和活动预告预留播放资产扩展点。",
    icon: IconPlayerPlay,
  },
];

export function IpDiscoveryPanel({
  siteLabel,
  databaseLabel,
}: {
  siteLabel: string;
  databaseLabel: string;
}) {
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="IP 广场运营位"
        description="这里承接 IP 广场的运营配置入口。当前页面先把运营边界固定清楚，后端表和 API 接入后直接替换为可编辑列表。"
      />

      <section className="grid gap-3 lg:grid-cols-2">
        {placements.map((placement) => {
          const Icon = placement.icon;
          return (
            <div
              key={placement.key}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="grid size-8 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
                    <Icon className="size-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-950">{placement.title}</h3>
                    <p className="text-[12px] text-slate-500">{placement.owner}</p>
                  </div>
                </div>
                <StatusPill tone="warn">{placement.status}</StatusPill>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">{placement.description}</p>
            </div>
          );
        })}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <h3 className="text-sm font-semibold text-slate-950">推荐的数据模型边界</h3>
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <ModelCell
            title="IpDiscoveryPlacement"
            description="定义站点、页面区域、状态、排序规则和生效窗口。"
          />
          <ModelCell
            title="IpDiscoveryItem"
            description="绑定 IP、运营素材、权重、上下线时间和实验扩展字段。"
          />
          <ModelCell
            title="IpDiscoveryItemLocalization"
            description="承载多语言标题、摘要、CTA 和运营说明，避免写死在 IP 本体。"
          />
        </div>
      </section>
    </div>
  );
}

function ModelCell({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-[12px] font-semibold text-slate-950">{title}</p>
      <p className="mt-1 text-[12px] leading-5 text-slate-600">{description}</p>
    </div>
  );
}
