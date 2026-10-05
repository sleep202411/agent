ALTER TYPE "IpReportReason" ADD VALUE IF NOT EXISTS 'payment';
ALTER TABLE ip_content_reports ADD COLUMN purchase_order_id uuid;
ALTER TABLE ip_content_reports ADD CONSTRAINT ip_content_reports_purchase_order_fk FOREIGN KEY (purchase_order_id) REFERENCES ip_purchase_orders(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX ip_content_reports_purchase_order_idx ON ip_content_reports(purchase_order_id);
CREATE FUNCTION protect_content_report_purchase_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE purchase ip_purchase_orders%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id THEN
  RAISE EXCEPTION 'Complaint purchase reference is immutable';
 END IF;
 IF NEW.purchase_order_id IS NOT NULL THEN
  SELECT * INTO purchase FROM ip_purchase_orders WHERE id=NEW.purchase_order_id FOR SHARE;
  IF NOT FOUND OR NEW.reporter_user_id IS DISTINCT FROM purchase.user_id OR NEW.ip_id IS DISTINCT FROM purchase.ip_id OR NEW.episode_id IS DISTINCT FROM purchase.episode_id OR NEW.target_type IS DISTINCT FROM purchase.target_type OR NEW.target_id IS DISTINCT FROM COALESCE(purchase.episode_id,purchase.ip_id)::text THEN
   RAISE EXCEPTION 'Complaint must reference the reporter own matching purchase';
  END IF;
 END IF;
 IF NEW.reason::text='payment' AND NEW.purchase_order_id IS NULL THEN
  RAISE EXCEPTION 'Payment complaint requires a verified purchase';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER content_report_purchase_reference_guard BEFORE INSERT OR UPDATE ON ip_content_reports FOR EACH ROW EXECUTE FUNCTION protect_content_report_purchase_reference();
