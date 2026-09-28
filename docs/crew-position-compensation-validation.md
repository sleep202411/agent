# Recruitment compensation validation — #549

The existing publish/edit position wizard previously checked only maximum-versus-minimum ordering. If either end was blank, a negative or over-limit amount could pass the client gate and reach the backend, which rejects it. Each entered amount now must be finite and between 0 and 100,000,000 inclusive, matching `SalarySchema` in the existing server DTO. Both blank and one-sided ranges remain supported; negotiable compensation keeps its existing null-amount payload. These are display-currency amounts, not minor units.

Invalid amounts display a dedicated error in English, Simplified Chinese and Traditional Chinese. Once individual amounts are valid, the existing range-order error remains available. Correcting an amount preserves the rest of the draft. No pricing, fee-agreement or accounting rule was introduced, and no backend/schema changes were made.

29 dialog tests passed, including one-sided negative/over-limit amounts, zero, the maximum boundary, decimal and blank values, and draft-preserving correction. Changed-file lint, translation/placeholder parity and diff checks passed. Full web typecheck passed; server checking remains skipped at Ric's request.

Local and uncommitted. Isaac/Yuanzheng should verify both new position publication and editing in the deployed regional environment, including negotiable and one-sided compensation. No deployment or issue closure is claimed.
