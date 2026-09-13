import { ProductionStageForm } from "@/components/admin/ip/production-stage-form";
import { getAdminSession } from "@/lib/admin-session";
import { fetchIpProductionStage } from "@/lib/admin-ip-commerce";
import Link from "next/link";
import { fetchIpProductionEvidence } from "@/lib/admin-ip-commerce";

export default async function IpProductionEvidencePage({
  params,
}: {
  params: Promise<{ ipId: string }>;
}) {
  const { ipId } = await params;
  const [{ data, error }, stage, session] = await Promise.all([
    fetchIpProductionEvidence(ipId),
    fetchIpProductionStage(ipId),
    getAdminSession(),
  ]);
  return (
    <main className="space-y-4 p-5">
      <Link href="/ip/titles" className="text-sm underline">
        Back to IP titles
      </Link>
      <h1 className="text-xl font-semibold">Production review evidence</h1>
      <p className="text-xs text-slate-500">IP {ipId}</p>
      {error ? (
        <div role="alert" className="text-sm text-red-700">
          {error}
        </div>
      ) : null}
      <a
        href={`/ip/titles/${encodeURIComponent(ipId)}/production`}
        className="inline-block text-sm underline"
      >
        Refresh evidence
      </a>
      {stage.error ? <div role="alert">{stage.error}</div> : null}
      {stage.data && session ? (
        <ProductionStageForm
          key={`${session.site.key}:${session.user.id}:${session.session.id}:${ipId}`}
          ipId={ipId}
          initial={stage.data}
          canApprove={session.user.permissions.includes("ip.publish")}
        />
      ) : null}
      {data ? (
        <>
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="text-slate-500">Publication status</dt>
              <dd>{data.publicationStatus}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Current human IP likes</dt>
              <dd className="font-mono">{data.humanIpLikes}</dd>
            </div>
          </dl>
          <p className="text-sm text-slate-600">
            Human IP likes are separate from Crew community membership. Evidence does not
            automatically approve a production stage.
          </p>
          <table className="w-full text-left text-sm">
            <caption className="py-3 text-left font-medium">First three published episodes</caption>
            <thead>
              <tr>
                <th scope="col">Episode</th>
                <th scope="col">Likes</th>
                <th scope="col">Dislikes</th>
              </tr>
            </thead>
            <tbody>
              {data.episodes.map((episode) => (
                <tr key={episode.episodeId} className="border-t border-slate-200">
                  <th scope="row" className="py-2">
                    {episode.episodeNo}
                  </th>
                  <td>{episode.likes}</td>
                  <td>{episode.dislikes}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.episodes.length ? (
            <p className="text-sm text-slate-500">No eligible published testing episodes.</p>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
