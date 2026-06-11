-- Rename the "bubble" compute-credit identifier to "compute_point" across the
-- three billing/wallet enums. In-place RENAME VALUE preserves any existing rows
-- (there are none in prod yet) — no compatibility shim: the product name
-- "bubble" is dropped from the system entirely.
ALTER TYPE "WalletCurrencyType" RENAME VALUE 'bubble' TO 'compute_point';
ALTER TYPE "BillingProductType" RENAME VALUE 'bubble_pack' TO 'compute_point_pack';
ALTER TYPE "BillingOrderType" RENAME VALUE 'bubble_topup' TO 'compute_point_topup';
