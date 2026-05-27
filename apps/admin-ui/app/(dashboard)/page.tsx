import { PageSection } from "@/components/page-section";
import { operationalQueues, overviewStats, paymentRails } from "@/lib/dashboard-data";

export default function OverviewPage() {
  return (
    <PageSection
      eyebrow="Overview"
      title="Operations control plane"
      description="A clean foundation for the new internal admin console. Real data will come from Nest admin APIs, not Java admin auth."
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {overviewStats.map((stat) => (
          <article key={stat.label} className="rounded-lg border border-[#262629] bg-[#141416] p-4">
            <p className="text-xs font-medium text-[#9ca0a8]">{stat.label}</p>
            <p className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white">
              {stat.value}
            </p>
            <p className="mt-3 min-h-10 text-xs leading-5 text-[#9ca0a8]">{stat.detail}</p>
          </article>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <section className="rounded-lg border border-[#262629] bg-[#141416]">
          <div className="border-b border-[#262629] px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Operational queues</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase text-[#6b6f78]">
                <tr className="border-b border-[#262629]">
                  <th className="px-4 py-3 font-medium">Queue</th>
                  <th className="px-4 py-3 font-medium">Region</th>
                  <th className="px-4 py-3 font-medium">Health</th>
                  <th className="px-4 py-3 font-medium">Backlog</th>
                  <th className="px-4 py-3 font-medium">Policy</th>
                </tr>
              </thead>
              <tbody>
                {operationalQueues.map((queue) => (
                  <tr key={queue.name} className="border-b border-[#1c1c1f]">
                    <td className="px-4 py-3 font-medium text-white">{queue.name}</td>
                    <td className="px-4 py-3 text-[#c8cad0]">{queue.region}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-[#c8cad0]">
                        {queue.health}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#c8cad0]">{queue.backlog}</td>
                    <td className="px-4 py-3 text-[#9ca0a8]">{queue.policy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-[#262629] bg-[#141416] p-4">
          <h2 className="text-sm font-semibold text-white">Payment rails</h2>
          <div className="mt-4 space-y-3">
            {paymentRails.map((rail) => (
              <div key={rail.site} className="rounded-md border border-[#262629] bg-[#101012] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">{rail.provider}</p>
                    <p className="text-xs text-[#9ca0a8]">
                      {rail.region} / {rail.site}
                    </p>
                  </div>
                  <span className="rounded border border-white/10 px-2 py-1 text-xs text-[#c8cad0]">
                    {rail.currency}
                  </span>
                </div>
                <p className="mt-3 text-xs leading-5 text-[#9ca0a8]">{rail.source}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </PageSection>
  );
}
