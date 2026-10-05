ALTER TABLE creator_withdrawals ADD CONSTRAINT creator_withdrawal_evidence_requires_paid CHECK((payment_proof_id IS NULL AND internal_payment_note IS NULL) OR status='paid');
CREATE OR REPLACE FUNCTION protect_withdrawal_proof() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM creator_withdrawals WHERE payment_proof_id=OLD.id) THEN RAISE EXCEPTION 'Attached payment proof cannot be deleted'; END IF;
  RETURN OLD;
 END IF;
 IF ROW(NEW.id,NEW.withdrawal_id,NEW.uploaded_by_admin_id,NEW.checksum_sha256,NEW.filename,NEW.content_type,NEW.size_bytes,NEW.provider,NEW.bucket,NEW.region,NEW.object_key,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.withdrawal_id,OLD.uploaded_by_admin_id,OLD.checksum_sha256,OLD.filename,OLD.content_type,OLD.size_bytes,OLD.provider,OLD.bucket,OLD.region,OLD.object_key,OLD.created_at) THEN
  RAISE EXCEPTION 'Payment proof identity is immutable';
 END IF;
 IF OLD.status='ready' AND NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN RAISE EXCEPTION 'Proof verification is immutable'; END IF;
 IF OLD.status='retired' AND NEW.status<>'retired' THEN RAISE EXCEPTION 'Retired proof cannot be restored'; END IF;
 IF OLD.status='ready' AND NEW.status NOT IN ('ready','retired') THEN RAISE EXCEPTION 'Ready proof cannot be reset'; END IF;
 IF NEW.status='retired' AND EXISTS(SELECT 1 FROM creator_withdrawals WHERE payment_proof_id=OLD.id) THEN RAISE EXCEPTION 'Attached proof cannot be retired'; END IF;
 RETURN NEW;
END $$;
