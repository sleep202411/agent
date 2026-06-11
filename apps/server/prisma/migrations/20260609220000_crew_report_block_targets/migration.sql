-- Crews join the existing user-moderation surface (content reports + viewer
-- blocks). Reports for crews carry targetType 'crew' with ip_id/episode_id
-- NULL; commerce tables sharing "IpTargetType" never write 'crew'.
ALTER TYPE "IpTargetType" ADD VALUE IF NOT EXISTS 'crew';
ALTER TYPE "IpUserBlockTargetType" ADD VALUE IF NOT EXISTS 'crew';
