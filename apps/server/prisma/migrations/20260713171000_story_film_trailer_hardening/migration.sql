-- Trailer reviews and approvals are audit records. Match the append-only
-- guarantees of Film Take review history at the database boundary.

CREATE TRIGGER "story_film_trailer_take_reviews_immutable_trg"
BEFORE UPDATE OR DELETE ON "story_film_trailer_take_reviews"
FOR EACH ROW EXECUTE FUNCTION "story_prevent_mutation"();

CREATE TRIGGER "story_film_trailer_take_approvals_immutable_trg"
BEFORE UPDATE OR DELETE ON "story_film_trailer_take_approvals"
FOR EACH ROW EXECUTE FUNCTION "story_prevent_mutation"();

