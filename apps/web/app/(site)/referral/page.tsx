import { ReferralDashboardPage } from "./_components/referral-dashboard";

/**
 * Invite-reward dashboard. Auth-gated by default (not in PUBLIC_PATTERNS):
 * the proxy bounces cookie-less visitors to login, and the mobile app embeds
 * this exact page in its AuthedWebView — keep it self-contained and
 * server-owned so reward copy can never drift from the configured ladder.
 */
export default function ReferralPage() {
  return (
    <main className="min-h-screen bg-background">
      <ReferralDashboardPage />
    </main>
  );
}
