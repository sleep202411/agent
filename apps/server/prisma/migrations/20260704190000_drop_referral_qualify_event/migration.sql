-- Drop the dead `qualify_event` column. It only ever held 'first_purchase'
-- (the 'signup' mode was never implementable — registration happens on Java
-- with no Nest-side trigger). The ladder is now registration-based and
-- commission/invitee perks trigger on the referee's first purchase directly,
-- so a configurable qualify mode has no meaning. Remove it cleanly.
ALTER TABLE "referral_programs" DROP COLUMN "qualify_event";
