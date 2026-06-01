import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/admin/brand-logo";
import { LoginForm } from "@/components/admin/login-form";
import { getAdminSession } from "@/lib/admin-session";
import { currentAdminSite } from "@/lib/admin-sites";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getAdminSession();
  if (session) redirect("/");
  const site = currentAdminSite();

  return (
    <main className="grid min-h-dvh bg-[#f6f7f9] lg:grid-cols-[0.95fr_1.05fr]">
      <section className="hidden border-r border-slate-200 bg-slate-950 p-8 text-white lg:flex lg:flex-col lg:justify-between">
        <div>
          <BrandLogo className="w-[184px]" />
          <div className="mt-12 max-w-lg">
            <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-slate-400">
              管理后台
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight">FizzDragon 管理后台</h1>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              本控制台仅服务 {site.shortLabel}，连接 {site.label} 的 Admin API 与
              {site.databaseLabel}。每个站点独立部署，不会把两套生产数据混在一个列表里。
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-[12px] text-slate-300">
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">独立数据库</div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">会话隔离</div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">审计留痕</div>
        </div>
      </section>

      <section className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-7 lg:hidden">
            <BrandLogo className="w-[164px]" />
            <h1 className="mt-5 text-2xl font-semibold tracking-tight">FizzDragon 管理后台</h1>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/70">
            <div className="mb-5">
              <h2 className="text-lg font-semibold tracking-tight">登录</h2>
              <p className="mt-1 text-[13px] text-slate-500">
                当前控制台为 {site.shortLabel}，使用对应站点的后台账号登录。
              </p>
            </div>
            {/* TODO: 当中国站后台部署后，在此处加入跳转到另一站点 admin 域名的链接（目前中国站未部署，暂不展示） */}
            <LoginForm site={site} />
          </div>
          <p className="mt-4 text-center text-[12px] text-slate-500">
            若没有账号，请先由具备 admin.manage 权限的管理员开通。
          </p>
        </div>
      </section>
    </main>
  );
}
