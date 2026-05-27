import { PageSection } from "@/components/page-section";

export default function WalletsPage() {
  return (
    <PageSection
      eyebrow="Wallets"
      title="Bubbles and community credits"
      description="Inspect balances, reservations, settlements, refunds, and manual adjustments with full audit trail."
    >
      <div className="rounded-lg border border-[#262629] bg-[#141416] p-6 text-sm text-[#9ca0a8]">
        Wallet lookup, ledger entries, reservations, refunds, and operator adjustment workflows will
        live here.
      </div>
    </PageSection>
  );
}
