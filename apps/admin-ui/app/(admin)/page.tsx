import {
  IconAlertTriangle,
  IconArrowUpRight,
  IconChecks,
  IconClockHour4,
} from "@tabler/icons-react";

const metrics = [
  { label: "待审核 IP", value: "12", delta: "含 3 个预售内容" },
  { label: "开放举报", value: "4", delta: "最早 2 小时前提交" },
  { label: "今日订单", value: "86", delta: "社区积分成交" },
  { label: "资产异常", value: "1", delta: "等待重新上传" },
];

const tasks = [
  {
    title: "中元节影游预售配置",
    detail: "检查早鸟价、倒计时、权益解锁时间和举报入口。",
    status: "高优先级",
  },
  {
    title: "IP 内容审核队列",
    detail: "上线前需完成版权声明、AI 生成声明、年龄分级核对。",
    status: "今天",
  },
  {
    title: "社区积分订单监控",
    detail: "关注充值到账、余额扣减和内容解锁链路。",
    status: "持续",
  },
];

export default function AdminHomePage() {
  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/50">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-[12px] font-medium tracking-[0.16em] text-slate-500">运营控制台</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              内容、积分、订单和审核的统一后台入口
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              后台权限独立于普通用户登录，所有敏感操作会写入审计日志。 当前先承接 IP
              商业化和社区积分上线所需的核心运营链路。
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
            <span className="font-medium text-slate-950">会话安全：</span>
            安全 Cookie / 角色权限 / 审计留痕
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-[12px] font-medium text-slate-500">{item.label}</p>
            <div className="mt-3 flex items-end justify-between gap-3">
              <span className="text-2xl font-semibold text-slate-950">{item.value}</span>
              <IconArrowUpRight className="size-4 text-slate-400" />
            </div>
            <p className="mt-2 text-[12px] text-slate-500">{item.delta}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-950">上线任务</h3>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-500">
              运营闭环
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {tasks.map((task) => (
              <div
                key={task.title}
                className="flex gap-3 rounded-lg border border-slate-100 bg-slate-50/70 p-3"
              >
                <span className="mt-0.5 grid size-7 place-items-center rounded-md bg-white text-slate-500">
                  <IconClockHour4 className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[13px] font-medium text-slate-950">{task.title}</p>
                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-500">
                      {task.status}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] leading-5 text-slate-500">{task.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-950">生产级基线</h3>
          <div className="mt-4 space-y-3 text-[13px] text-slate-600">
            <p className="flex gap-2">
              <IconChecks className="mt-0.5 size-4 text-emerald-600" />
              权限不复用 Java 普通用户会话。
            </p>
            <p className="flex gap-2">
              <IconChecks className="mt-0.5 size-4 text-emerald-600" />
              角色、权限和后台会话由 Postgres 独立管理。
            </p>
            <p className="flex gap-2">
              <IconAlertTriangle className="mt-0.5 size-4 text-amber-600" />
              正式启用前需要配置首个 bootstrap 管理员。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
