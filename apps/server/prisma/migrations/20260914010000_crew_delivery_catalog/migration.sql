CREATE TABLE crew_delivery_catalog_revisions (
  category_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  definition JSONB NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  created_by UUID NOT NULL,
  reason TEXT NOT NULL CHECK (length(reason) > 0),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (category_id, version)
);
