-- Crew collaboration messages can carry a durable task reference. Image and
-- file enum values already exist; their payloads now reference crew assets.
ALTER TYPE "message_type" ADD VALUE 'task';
