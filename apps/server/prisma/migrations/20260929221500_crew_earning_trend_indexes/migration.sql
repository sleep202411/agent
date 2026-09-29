-- Support bounded posted-income aggregation without scanning older ledger history.
CREATE INDEX "crew_earning_entries_crew_posted_trend_idx"
  ON "crew_earning_entries" ("crew_id", "currency", "status", "posted_at");
CREATE INDEX "crew_earning_entries_user_posted_trend_idx"
  ON "crew_earning_entries" ("user_id", "currency", "status", "posted_at");
