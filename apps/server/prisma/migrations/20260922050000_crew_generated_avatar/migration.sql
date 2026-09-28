-- IP-created Crews start without an uploaded logo and use the generated avatar.
-- Manual Crew creation still requires a logo through its request schema.
ALTER TABLE "crews" DROP CONSTRAINT "crews_logo_length_chk";
ALTER TABLE "crews" ADD CONSTRAINT "crews_logo_length_chk"
  CHECK (char_length("logo") <= 512);
