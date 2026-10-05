-- SQL-owned private evidence/recovery table. A ready upload is attached only by
-- the transaction that records payment; abandoned uploads can be retired later.
CREATE TABLE creator_withdrawal_proofs (
 id uuid PRIMARY KEY,
 withdrawal_id uuid NOT NULL REFERENCES creator_withdrawals(id) ON DELETE RESTRICT,
 uploaded_by_admin_id varchar(64) NOT NULL,
 checksum_sha256 varchar(64) NOT NULL,
 filename varchar(240) NOT NULL,
 content_type varchar(32) NOT NULL CHECK(content_type IN ('application/pdf','image/jpeg','image/png')),
 size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
 provider "MediaStorageProvider" NOT NULL CHECK(provider <> 'external_url'),
 bucket text NOT NULL, region text, object_key text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'uploading' CHECK(status IN ('uploading','ready','retired')),
 verified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 next_attempt_at timestamptz DEFAULT now()+interval '24 hours',
 CHECK((status='ready' AND verified_at IS NOT NULL) OR status<>'ready')
);
CREATE INDEX creator_withdrawal_proofs_cleanup_idx ON creator_withdrawal_proofs(next_attempt_at,id);
CREATE INDEX creator_withdrawal_proofs_request_idx ON creator_withdrawal_proofs(withdrawal_id,checksum_sha256);
ALTER TABLE creator_withdrawals ADD COLUMN payment_proof_id uuid REFERENCES creator_withdrawal_proofs(id) ON DELETE RESTRICT;
ALTER TABLE creator_withdrawals ADD COLUMN internal_payment_note varchar(2000);
CREATE FUNCTION protect_withdrawal_payment_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='paid' AND ROW(NEW.payment_proof_id,NEW.internal_payment_note) IS DISTINCT FROM ROW(OLD.payment_proof_id,OLD.internal_payment_note) THEN
  RAISE EXCEPTION 'Paid withdrawal evidence is immutable';
 END IF;
 IF NEW.payment_proof_id IS DISTINCT FROM OLD.payment_proof_id OR NEW.internal_payment_note IS DISTINCT FROM OLD.internal_payment_note THEN
  IF OLD.status<>'processing' OR NEW.status<>'paid' THEN RAISE EXCEPTION 'Payment evidence requires the payment transition'; END IF;
 END IF;
 IF NEW.payment_proof_id IS NOT NULL THEN
  PERFORM 1 FROM creator_withdrawal_proofs WHERE id=NEW.payment_proof_id AND withdrawal_id=NEW.id AND status='ready' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment proof must be a ready file for this withdrawal'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER creator_withdrawal_payment_evidence_guard BEFORE UPDATE ON creator_withdrawals FOR EACH ROW EXECUTE FUNCTION protect_withdrawal_payment_evidence();
CREATE FUNCTION protect_withdrawal_proof() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM creator_withdrawals WHERE payment_proof_id=OLD.id) THEN RAISE EXCEPTION 'Attached payment proof cannot be deleted'; END IF;
  RETURN OLD;
 END IF;
 IF ROW(NEW.withdrawal_id,NEW.uploaded_by_admin_id,NEW.checksum_sha256,NEW.filename,NEW.content_type,NEW.size_bytes,NEW.provider,NEW.bucket,NEW.region,NEW.object_key,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.withdrawal_id,OLD.uploaded_by_admin_id,OLD.checksum_sha256,OLD.filename,OLD.content_type,OLD.size_bytes,OLD.provider,OLD.bucket,OLD.region,OLD.object_key,OLD.created_at) THEN
  RAISE EXCEPTION 'Payment proof identity is immutable';
 END IF;
 IF OLD.status='retired' AND NEW.status<>'retired' THEN RAISE EXCEPTION 'Retired proof cannot be restored'; END IF;
 IF OLD.status='ready' AND NEW.status NOT IN ('ready','retired') THEN RAISE EXCEPTION 'Ready proof cannot be reset'; END IF;
 IF NEW.status='retired' AND EXISTS(SELECT 1 FROM creator_withdrawals WHERE payment_proof_id=OLD.id) THEN RAISE EXCEPTION 'Attached proof cannot be retired'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER creator_withdrawal_proof_guard BEFORE UPDATE OR DELETE ON creator_withdrawal_proofs FOR EACH ROW EXECUTE FUNCTION protect_withdrawal_proof();
