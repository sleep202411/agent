import { PageSection } from "@/components/page-section";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
          <Card key={stat.label} className="border-border bg-card">
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground">{stat.label}</p>
              <p className="mt-3 text-3xl font-semibold tracking-[-0.03em]">{stat.value}</p>
              <p className="mt-3 min-h-10 text-xs leading-5 text-muted-foreground">{stat.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card className="overflow-hidden border-border bg-card">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-sm">Operational queues</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Queue</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Backlog</TableHead>
                  <TableHead>Policy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {operationalQueues.map((queue) => (
                  <TableRow key={queue.name}>
                    <TableCell className="font-medium text-foreground">{queue.name}</TableCell>
                    <TableCell>{queue.region}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{queue.health}</Badge>
                    </TableCell>
                    <TableCell>{queue.backlog}</TableCell>
                    <TableCell className="text-muted-foreground">{queue.policy}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-sm">Payment rails</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {paymentRails.map((rail) => (
              <div key={rail.site} className="rounded-md border border-border bg-background p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{rail.provider}</p>
                    <p className="text-xs text-muted-foreground">
                      {rail.region} / {rail.site}
                    </p>
                  </div>
                  <Badge variant="outline">{rail.currency}</Badge>
                </div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">{rail.source}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </PageSection>
  );
}
