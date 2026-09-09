BEGIN;

CREATE SEQUENCE ip_room_number_seq AS bigint START WITH 100001 NO CYCLE;

-- The volatile default allocates a different number to every existing row,
-- including drafts and archived IPs, and to every future insert.
ALTER TABLE ips
  ADD COLUMN room_number varchar(19) NOT NULL
    DEFAULT nextval('ip_room_number_seq'::regclass)::text,
  ADD CONSTRAINT ips_room_number_key UNIQUE (room_number),
  ADD CONSTRAINT ips_room_number_format_check
    CHECK (room_number ~ '^[1-9][0-9]{0,18}$');

ALTER SEQUENCE ip_room_number_seq OWNED BY ips.room_number;

COMMIT;
