-- Generated from the pinned @mastra/pg framework domains.
-- Do not edit after application; add a new migration for future adapter changes.
-- mastra-framework-ddl:start
CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_notifications" (
              "id" TEXT NOT NULL,
"threadId" TEXT NOT NULL,
"source" TEXT NOT NULL,
"kind" TEXT NOT NULL,
"priority" TEXT NOT NULL,
"status" TEXT NOT NULL,
"summary" TEXT NOT NULL,
"payload" JSONB ,
"resourceId" TEXT ,
"agentId" TEXT ,
"sourceId" TEXT ,
"dedupeKey" TEXT ,
"coalesceKey" TEXT ,
"coalescedCount" INTEGER NOT NULL,
"attributes" JSONB ,
"createdAt" TIMESTAMP NOT NULL,
"updatedAt" TIMESTAMP NOT NULL,
"deliveredAt" TIMESTAMP ,
"seenAt" TIMESTAMP ,
"dismissedAt" TIMESTAMP ,
"archivedAt" TIMESTAMP ,
"discardedAt" TIMESTAMP ,
"deliverAt" TIMESTAMP ,
"summaryAt" TIMESTAMP ,
"deliveryReason" TEXT ,
"deliveryAttempts" INTEGER NOT NULL,
"lastDeliveryAttemptAt" TIMESTAMP ,
"lastDeliveryError" TEXT ,
"deliveredSignalId" TEXT ,
"summarySignalId" TEXT ,
"metadata" JSONB ,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW(),
"updatedAtZ" TIMESTAMPTZ DEFAULT NOW(),
"deliveredAtZ" TIMESTAMPTZ DEFAULT NOW(),
"seenAtZ" TIMESTAMPTZ DEFAULT NOW(),
"dismissedAtZ" TIMESTAMPTZ DEFAULT NOW(),
"archivedAtZ" TIMESTAMPTZ DEFAULT NOW(),
"discardedAtZ" TIMESTAMPTZ DEFAULT NOW(),
"deliverAtZ" TIMESTAMPTZ DEFAULT NOW(),
"summaryAtZ" TIMESTAMPTZ DEFAULT NOW(),
"lastDeliveryAttemptAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          
CREATE INDEX IF NOT EXISTS "agent_memory_idx_notifications_thread_status_updated" ON "agent_memory"."mastra_notifications" ("threadId", "status", "updatedAt");
CREATE INDEX IF NOT EXISTS "agent_memory_idx_notifications_coalescing" ON "agent_memory"."mastra_notifications" ("threadId", "source", "kind", "status", "agentId", "resourceId", "dedupeKey", "coalesceKey");
CREATE INDEX IF NOT EXISTS "agent_memory_idx_notifications_due" ON "agent_memory"."mastra_notifications" ("status", "deliverAt", "summaryAt");

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_ai_spans" (
              "traceId" TEXT NOT NULL,
"spanId" TEXT NOT NULL,
"name" TEXT NOT NULL,
"spanType" TEXT NOT NULL,
"isEvent" BOOLEAN NOT NULL,
"startedAt" TIMESTAMP NOT NULL,
"parentSpanId" TEXT ,
"entityType" TEXT ,
"entityId" TEXT ,
"entityName" TEXT ,
"parentEntityType" TEXT ,
"parentEntityId" TEXT ,
"parentEntityName" TEXT ,
"rootEntityType" TEXT ,
"rootEntityId" TEXT ,
"rootEntityName" TEXT ,
"userId" TEXT ,
"organizationId" TEXT ,
"resourceId" TEXT ,
"runId" TEXT ,
"sessionId" TEXT ,
"threadId" TEXT ,
"requestId" TEXT ,
"environment" TEXT ,
"serviceName" TEXT ,
"scope" JSONB ,
"entityVersionId" TEXT ,
"parentEntityVersionId" TEXT ,
"rootEntityVersionId" TEXT ,
"experimentId" TEXT ,
"source" TEXT ,
"metadata" JSONB ,
"tags" JSONB ,
"attributes" JSONB ,
"links" JSONB ,
"input" JSONB ,
"output" JSONB ,
"error" JSONB ,
"endedAt" TIMESTAMP ,
"requestContext" JSONB ,
"createdAt" TIMESTAMP NOT NULL,
"updatedAt" TIMESTAMP ,
"startedAtZ" TIMESTAMPTZ DEFAULT NOW(),
"endedAtZ" TIMESTAMPTZ DEFAULT NOW(),
"createdAtZ" TIMESTAMPTZ DEFAULT NOW(),
"updatedAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
            DO $$ BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = lower('agent_memory_mastra_ai_spans_traceid_spanid_pk') AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'agent_memory')
              ) THEN
                ALTER TABLE "agent_memory"."mastra_ai_spans"
                ADD CONSTRAINT agent_memory_mastra_ai_spans_traceid_spanid_pk
                PRIMARY KEY ("traceId", "spanId");
              END IF;
            END $$;
            
          
CREATE OR REPLACE FUNCTION "agent_memory".trigger_set_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW."createdAt" = NOW();
        NEW."updatedAt" = NOW();
        NEW."createdAtZ" = NOW();
        NEW."updatedAtZ" = NOW();
    ELSIF TG_OP = 'UPDATE' THEN
        NEW."updatedAt" = NOW();
        NEW."updatedAtZ" = NOW();
        NEW."createdAt" = OLD."createdAt";
        NEW."createdAtZ" = OLD."createdAtZ";
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "mastra_ai_spans_timestamps" ON "agent_memory"."mastra_ai_spans";

CREATE TRIGGER "mastra_ai_spans_timestamps"
    BEFORE INSERT OR UPDATE ON "agent_memory"."mastra_ai_spans"
    FOR EACH ROW
    EXECUTE FUNCTION "agent_memory".trigger_set_timestamps();
CREATE INDEX IF NOT EXISTS "agent_memory_mastra_ai_spans_traceid_startedat_idx" ON "agent_memory"."mastra_ai_spans" ("traceId", "startedAt" DESC);
CREATE INDEX IF NOT EXISTS "agent_memory_mastra_ai_spans_parentspanid_startedat_idx" ON "agent_memory"."mastra_ai_spans" ("parentSpanId", "startedAt" DESC);
CREATE INDEX IF NOT EXISTS "agent_memory_mastra_ai_spans_name_idx" ON "agent_memory"."mastra_ai_spans" ("name");
CREATE INDEX IF NOT EXISTS "agent_memory_mastra_ai_spans_spantype_startedat_idx" ON "agent_memory"."mastra_ai_spans" ("spanType", "startedAt" DESC);
CREATE INDEX IF NOT EXISTS "agent_memory_mastra_ai_spans_root_spans_idx" ON "agent_memory"."mastra_ai_spans" ("startedAt" DESC) WHERE "parentSpanId" IS NULL;
CREATE INDEX IF NOT EXISTS "agent_memory_mastra_ai_spans_entitytype_entityid_idx" ON "agent_memory"."mastra_ai_spans" ("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "agent_memory_mastra_ai_spans_entitytype_entityname_idx" ON "agent_memory"."mastra_ai_spans" ("entityType", "entityName");
CREATE INDEX IF NOT EXISTS "agent_memory_mastra_ai_spans_orgid_userid_idx" ON "agent_memory"."mastra_ai_spans" ("organizationId", "userId");
CREATE INDEX IF NOT EXISTS "agent_memory_mastra_ai_spans_metadata_gin_idx" ON "agent_memory"."mastra_ai_spans" USING gin ("metadata");
CREATE INDEX IF NOT EXISTS "agent_memory_mastra_ai_spans_tags_gin_idx" ON "agent_memory"."mastra_ai_spans" USING gin ("tags");

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_scorers" (
              "id" TEXT PRIMARY KEY NOT NULL,
"scorerId" TEXT NOT NULL,
"traceId" TEXT ,
"spanId" TEXT ,
"runId" TEXT NOT NULL,
"scorer" JSONB NOT NULL,
"preprocessStepResult" JSONB ,
"extractStepResult" JSONB ,
"analyzeStepResult" JSONB ,
"score" FLOAT NOT NULL,
"reason" TEXT ,
"metadata" JSONB ,
"preprocessPrompt" TEXT ,
"extractPrompt" TEXT ,
"generateScorePrompt" TEXT ,
"generateReasonPrompt" TEXT ,
"analyzePrompt" TEXT ,
"reasonPrompt" TEXT ,
"input" JSONB NOT NULL,
"output" JSONB NOT NULL,
"additionalContext" JSONB ,
"requestContext" JSONB ,
"entityType" TEXT ,
"entity" JSONB ,
"entityId" TEXT ,
"source" TEXT NOT NULL,
"resourceId" TEXT ,
"threadId" TEXT ,
"organizationId" TEXT ,
"projectId" TEXT ,
"batchId" TEXT ,
"datasetId" TEXT ,
"datasetItemId" TEXT ,
"createdAt" TIMESTAMP NOT NULL,
"updatedAt" TIMESTAMP NOT NULL,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW(),
"updatedAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          
CREATE INDEX IF NOT EXISTS "agent_memory_mastra_scores_trace_id_span_id_created_at_idx" ON "agent_memory"."mastra_scorers" ("traceId", "spanId", "createdAt" DESC);

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_scorer_definitions" (
              "id" TEXT PRIMARY KEY NOT NULL,
"status" TEXT NOT NULL,
"activeVersionId" TEXT ,
"authorId" TEXT ,
"organizationId" TEXT ,
"projectId" TEXT ,
"metadata" JSONB ,
"createdAt" TIMESTAMP NOT NULL,
"updatedAt" TIMESTAMP NOT NULL,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW(),
"updatedAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_scorer_definition_versions" (
              "id" TEXT PRIMARY KEY NOT NULL,
"scorerDefinitionId" TEXT NOT NULL,
"versionNumber" INTEGER NOT NULL,
"name" TEXT NOT NULL,
"description" TEXT ,
"type" TEXT NOT NULL,
"model" JSONB ,
"instructions" TEXT ,
"scoreRange" JSONB ,
"presetConfig" JSONB ,
"defaultSampling" JSONB ,
"changedFields" JSONB ,
"changeMessage" TEXT ,
"createdAt" TIMESTAMP NOT NULL,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          
CREATE UNIQUE INDEX IF NOT EXISTS "agent_memory_idx_scorer_definition_versions_def_version" ON "agent_memory"."mastra_scorer_definition_versions" ("scorerDefinitionId", "versionNumber");

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_prompt_blocks" (
              "id" TEXT PRIMARY KEY NOT NULL,
"status" TEXT NOT NULL,
"activeVersionId" TEXT ,
"authorId" TEXT ,
"metadata" JSONB ,
"createdAt" TIMESTAMP NOT NULL,
"updatedAt" TIMESTAMP NOT NULL,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW(),
"updatedAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_prompt_block_versions" (
              "id" TEXT PRIMARY KEY NOT NULL,
"blockId" TEXT NOT NULL,
"versionNumber" INTEGER NOT NULL,
"name" TEXT NOT NULL,
"description" TEXT ,
"content" TEXT NOT NULL,
"rules" JSONB ,
"requestContextSchema" JSONB ,
"changedFields" JSONB ,
"changeMessage" TEXT ,
"createdAt" TIMESTAMP NOT NULL,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          
CREATE UNIQUE INDEX IF NOT EXISTS "agent_memory_idx_prompt_block_versions_block_version" ON "agent_memory"."mastra_prompt_block_versions" ("blockId", "versionNumber");

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_agents" (
              "id" TEXT PRIMARY KEY NOT NULL,
"status" TEXT NOT NULL,
"activeVersionId" TEXT ,
"authorId" TEXT ,
"visibility" TEXT ,
"metadata" JSONB ,
"favoriteCount" INTEGER ,
"createdAt" TIMESTAMP NOT NULL,
"updatedAt" TIMESTAMP NOT NULL,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW(),
"updatedAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_agent_versions" (
              "id" TEXT PRIMARY KEY NOT NULL,
"agentId" TEXT NOT NULL,
"versionNumber" INTEGER NOT NULL,
"name" TEXT NOT NULL,
"description" TEXT ,
"instructions" TEXT NOT NULL,
"model" JSONB NOT NULL,
"tools" JSONB ,
"defaultOptions" JSONB ,
"workflows" JSONB ,
"agents" JSONB ,
"integrationTools" JSONB ,
"toolProviders" JSONB ,
"inputProcessors" JSONB ,
"outputProcessors" JSONB ,
"memory" JSONB ,
"scorers" JSONB ,
"mcpClients" JSONB ,
"requestContextSchema" JSONB ,
"workspace" JSONB ,
"skills" JSONB ,
"skillsFormat" TEXT ,
"browser" JSONB ,
"changedFields" JSONB ,
"changeMessage" TEXT ,
"createdAt" TIMESTAMP NOT NULL,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_mcp_clients" (
              "id" TEXT PRIMARY KEY NOT NULL,
"status" TEXT NOT NULL,
"activeVersionId" TEXT ,
"authorId" TEXT ,
"metadata" JSONB ,
"createdAt" TIMESTAMP NOT NULL,
"updatedAt" TIMESTAMP NOT NULL,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW(),
"updatedAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_mcp_client_versions" (
              "id" TEXT PRIMARY KEY NOT NULL,
"mcpClientId" TEXT NOT NULL,
"versionNumber" INTEGER NOT NULL,
"name" TEXT NOT NULL,
"description" TEXT ,
"servers" JSONB NOT NULL,
"changedFields" JSONB ,
"changeMessage" TEXT ,
"createdAt" TIMESTAMP NOT NULL,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          
CREATE UNIQUE INDEX IF NOT EXISTS "agent_memory_idx_mcp_client_versions_client_version" ON "agent_memory"."mastra_mcp_client_versions" ("mcpClientId", "versionNumber");

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_mcp_servers" (
              "id" TEXT PRIMARY KEY NOT NULL,
"status" TEXT NOT NULL,
"activeVersionId" TEXT ,
"authorId" TEXT ,
"metadata" JSONB ,
"createdAt" TIMESTAMP NOT NULL,
"updatedAt" TIMESTAMP NOT NULL,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW(),
"updatedAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_mcp_server_versions" (
              "id" TEXT PRIMARY KEY NOT NULL,
"mcpServerId" TEXT NOT NULL,
"versionNumber" INTEGER NOT NULL,
"name" TEXT NOT NULL,
"version" TEXT NOT NULL,
"description" TEXT ,
"instructions" TEXT ,
"repository" JSONB ,
"releaseDate" TEXT ,
"isLatest" BOOLEAN ,
"packageCanonical" TEXT ,
"tools" JSONB ,
"agents" JSONB ,
"workflows" JSONB ,
"changedFields" JSONB ,
"changeMessage" TEXT ,
"createdAt" TIMESTAMP NOT NULL,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          
CREATE UNIQUE INDEX IF NOT EXISTS "agent_memory_idx_mcp_server_versions_server_version" ON "agent_memory"."mastra_mcp_server_versions" ("mcpServerId", "versionNumber");

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_workspaces" (
              "id" TEXT PRIMARY KEY NOT NULL,
"status" TEXT NOT NULL,
"activeVersionId" TEXT ,
"authorId" TEXT ,
"metadata" JSONB ,
"createdAt" TIMESTAMP NOT NULL,
"updatedAt" TIMESTAMP NOT NULL,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW(),
"updatedAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_workspace_versions" (
              "id" TEXT PRIMARY KEY NOT NULL,
"workspaceId" TEXT NOT NULL,
"versionNumber" INTEGER NOT NULL,
"name" TEXT NOT NULL,
"description" TEXT ,
"filesystem" JSONB ,
"sandbox" JSONB ,
"mounts" JSONB ,
"search" JSONB ,
"skills" JSONB ,
"tools" JSONB ,
"autoSync" BOOLEAN ,
"operationTimeout" INTEGER ,
"changedFields" JSONB ,
"changeMessage" TEXT ,
"createdAt" TIMESTAMP NOT NULL,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          
CREATE UNIQUE INDEX IF NOT EXISTS "agent_memory_idx_workspace_versions_workspace_version" ON "agent_memory"."mastra_workspace_versions" ("workspaceId", "versionNumber");

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_skills" (
              "id" TEXT PRIMARY KEY NOT NULL,
"status" TEXT NOT NULL,
"activeVersionId" TEXT ,
"authorId" TEXT ,
"visibility" TEXT ,
"favoriteCount" INTEGER ,
"createdAt" TIMESTAMP NOT NULL,
"updatedAt" TIMESTAMP NOT NULL,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW(),
"updatedAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_skill_versions" (
              "id" TEXT PRIMARY KEY NOT NULL,
"skillId" TEXT NOT NULL,
"versionNumber" INTEGER NOT NULL,
"name" TEXT NOT NULL,
"description" TEXT NOT NULL,
"instructions" TEXT NOT NULL,
"license" TEXT ,
"compatibility" JSONB ,
"source" JSONB ,
"references" JSONB ,
"scripts" JSONB ,
"assets" JSONB ,
"files" JSONB ,
"metadata" JSONB ,
"tree" JSONB ,
"changedFields" JSONB ,
"changeMessage" TEXT ,
"createdAt" TIMESTAMP NOT NULL,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          
CREATE UNIQUE INDEX IF NOT EXISTS "agent_memory_idx_skill_versions_skill_version" ON "agent_memory"."mastra_skill_versions" ("skillId", "versionNumber");

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_skill_blobs" (
              "hash" TEXT PRIMARY KEY NOT NULL,
"content" TEXT NOT NULL,
"size" INTEGER NOT NULL,
"mimeType" TEXT ,
"createdAt" TIMESTAMP NOT NULL,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_tool_provider_connections" (
              "authorId" TEXT NOT NULL,
"providerId" TEXT NOT NULL,
"connectionId" TEXT NOT NULL,
"toolkit" TEXT NOT NULL,
"label" TEXT ,
"scope" TEXT NOT NULL,
"createdAt" TIMESTAMP NOT NULL,
"updatedAt" TIMESTAMP NOT NULL,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW(),
"updatedAtZ" TIMESTAMPTZ DEFAULT NOW(),
PRIMARY KEY ("authorId", "providerId", "connectionId")
            );
            
          
          
CREATE INDEX IF NOT EXISTS "agent_memory_idx_tool_provider_connections_author" ON "agent_memory"."mastra_tool_provider_connections" ("authorId", "providerId", "toolkit");

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_workflow_snapshot" (
              "workflow_name" TEXT NOT NULL,
"run_id" TEXT NOT NULL,
"resourceId" TEXT ,
"snapshot" JSONB NOT NULL,
"createdAt" TIMESTAMP NOT NULL,
"updatedAt" TIMESTAMP NOT NULL,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW(),
"updatedAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
            DO $$ BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = lower('agent_memory_mastra_workflow_snapshot_workflow_name_run_id_key') AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'agent_memory')
              ) AND NOT EXISTS (
                SELECT 1 FROM pg_indexes WHERE indexname = lower('agent_memory_mastra_workflow_snapshot_workflow_name_run_id_key') AND schemaname = 'agent_memory'
              ) THEN
                ALTER TABLE "agent_memory"."mastra_workflow_snapshot"
                ADD CONSTRAINT agent_memory_mastra_workflow_snapshot_workflow_name_run_id_key
                UNIQUE (workflow_name, run_id);
              END IF;
              IF EXISTS (
                SELECT 1 FROM pg_index i
                JOIN pg_class c ON i.indexrelid = c.oid
                JOIN pg_namespace n ON c.relnamespace = n.oid
                WHERE c.relname = lower('agent_memory_mastra_workflow_snapshot_workflow_name_run_id_key')
                AND n.nspname = 'agent_memory'
                AND i.indisreplident = false
              ) THEN
                ALTER TABLE "agent_memory"."mastra_workflow_snapshot"
                REPLICA IDENTITY USING INDEX agent_memory_mastra_workflow_snapshot_workflow_name_run_id_key;
              END IF;
            END $$;
            
          
          

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_datasets" (
              "id" TEXT PRIMARY KEY NOT NULL,
"name" TEXT NOT NULL,
"description" TEXT ,
"metadata" JSONB ,
"inputSchema" JSONB ,
"groundTruthSchema" JSONB ,
"requestContextSchema" JSONB ,
"tags" JSONB ,
"targetType" TEXT ,
"targetIds" JSONB ,
"scorerIds" JSONB ,
"organizationId" TEXT ,
"projectId" TEXT ,
"candidateKey" TEXT ,
"candidateId" TEXT ,
"version" INTEGER NOT NULL,
"createdAt" TIMESTAMP NOT NULL,
"updatedAt" TIMESTAMP NOT NULL,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW(),
"updatedAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_dataset_items" (
              "id" TEXT NOT NULL,
"datasetId" TEXT NOT NULL,
"datasetVersion" INTEGER NOT NULL,
"externalId" TEXT ,
"organizationId" TEXT ,
"projectId" TEXT ,
"validTo" INTEGER ,
"isDeleted" BOOLEAN NOT NULL,
"input" JSONB NOT NULL,
"groundTruth" JSONB ,
"requestContext" JSONB ,
"metadata" JSONB ,
"source" JSONB ,
"expectedTrajectory" JSONB ,
"toolMocks" JSONB ,
"createdAt" TIMESTAMP NOT NULL,
"updatedAt" TIMESTAMP NOT NULL,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW(),
"updatedAtZ" TIMESTAMPTZ DEFAULT NOW(),
PRIMARY KEY ("id", "datasetVersion")
            );
            
          
          

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_dataset_versions" (
              "id" TEXT PRIMARY KEY NOT NULL,
"datasetId" TEXT NOT NULL,
"version" INTEGER NOT NULL,
"createdAt" TIMESTAMP NOT NULL,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_experiments" (
              "id" TEXT PRIMARY KEY NOT NULL,
"name" TEXT ,
"description" TEXT ,
"metadata" JSONB ,
"datasetId" TEXT ,
"datasetVersion" INTEGER ,
"targetType" TEXT NOT NULL,
"targetId" TEXT NOT NULL,
"status" TEXT NOT NULL,
"totalItems" INTEGER NOT NULL,
"succeededCount" INTEGER NOT NULL,
"failedCount" INTEGER NOT NULL,
"skippedCount" INTEGER NOT NULL,
"startedAt" TIMESTAMP ,
"completedAt" TIMESTAMP ,
"agentVersion" TEXT ,
"organizationId" TEXT ,
"projectId" TEXT ,
"createdAt" TIMESTAMP NOT NULL,
"updatedAt" TIMESTAMP NOT NULL,
"startedAtZ" TIMESTAMPTZ DEFAULT NOW(),
"completedAtZ" TIMESTAMPTZ DEFAULT NOW(),
"createdAtZ" TIMESTAMPTZ DEFAULT NOW(),
"updatedAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_experiment_results" (
              "id" TEXT PRIMARY KEY NOT NULL,
"experimentId" TEXT NOT NULL,
"itemId" TEXT NOT NULL,
"itemDatasetVersion" INTEGER ,
"input" JSONB NOT NULL,
"output" JSONB ,
"groundTruth" JSONB ,
"error" JSONB ,
"startedAt" TIMESTAMP NOT NULL,
"completedAt" TIMESTAMP NOT NULL,
"retryCount" INTEGER NOT NULL,
"traceId" TEXT ,
"status" TEXT ,
"tags" JSONB ,
"toolMockReport" JSONB ,
"organizationId" TEXT ,
"projectId" TEXT ,
"createdAt" TIMESTAMP NOT NULL,
"startedAtZ" TIMESTAMPTZ DEFAULT NOW(),
"completedAtZ" TIMESTAMPTZ DEFAULT NOW(),
"createdAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_background_tasks" (
              "id" TEXT PRIMARY KEY NOT NULL,
"tool_call_id" TEXT NOT NULL,
"tool_name" TEXT NOT NULL,
"agent_id" TEXT NOT NULL,
"run_id" TEXT NOT NULL,
"thread_id" TEXT ,
"resource_id" TEXT ,
"status" TEXT NOT NULL,
"args" JSONB NOT NULL,
"result" JSONB ,
"error" JSONB ,
"suspend_payload" JSONB ,
"retry_count" INTEGER NOT NULL,
"max_retries" INTEGER NOT NULL,
"timeout_ms" INTEGER NOT NULL,
"createdAt" TIMESTAMP NOT NULL,
"startedAt" TIMESTAMP ,
"suspendedAt" TIMESTAMP ,
"completedAt" TIMESTAMP ,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW(),
"startedAtZ" TIMESTAMPTZ DEFAULT NOW(),
"suspendedAtZ" TIMESTAMPTZ DEFAULT NOW(),
"completedAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          
CREATE INDEX IF NOT EXISTS "agent_memory_mastra_bg_tasks_status_created_at_idx" ON "agent_memory"."mastra_background_tasks" ("status", "createdAt");
CREATE INDEX IF NOT EXISTS "agent_memory_mastra_bg_tasks_agent_status_idx" ON "agent_memory"."mastra_background_tasks" ("agent_id", "status");
CREATE INDEX IF NOT EXISTS "agent_memory_mastra_bg_tasks_thread_idx" ON "agent_memory"."mastra_background_tasks" ("thread_id", "createdAt");
CREATE INDEX IF NOT EXISTS "agent_memory_mastra_bg_tasks_tool_call_idx" ON "agent_memory"."mastra_background_tasks" ("tool_call_id");

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_favorites" (
              "userId" TEXT NOT NULL,
"entityType" TEXT NOT NULL,
"entityId" TEXT NOT NULL,
"createdAt" TIMESTAMP NOT NULL,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW(),
PRIMARY KEY ("userId", "entityType", "entityId")
            );
            
          
          
CREATE INDEX IF NOT EXISTS idx_favorites_entity ON "agent_memory"."mastra_favorites" ("entityType", "entityId");

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_channel_installations" (
              "id" TEXT PRIMARY KEY NOT NULL,
"platform" TEXT NOT NULL,
"agentId" TEXT NOT NULL,
"status" TEXT NOT NULL,
"webhookId" TEXT ,
"data" JSONB NOT NULL,
"configHash" TEXT ,
"error" TEXT ,
"createdAt" TIMESTAMP NOT NULL,
"updatedAt" TIMESTAMP NOT NULL,
"createdAtZ" TIMESTAMPTZ DEFAULT NOW(),
"updatedAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_channel_config" (
              "platform" TEXT PRIMARY KEY NOT NULL,
"data" JSONB NOT NULL,
"updatedAt" TIMESTAMP NOT NULL,
"updatedAtZ" TIMESTAMPTZ DEFAULT NOW()
            );
            
          
          
CREATE UNIQUE INDEX IF NOT EXISTS "agent_memory_idx_channel_installations_webhook" ON "agent_memory"."mastra_channel_installations" ("webhookId");
CREATE INDEX IF NOT EXISTS "agent_memory_idx_channel_installations_platform_agent" ON "agent_memory"."mastra_channel_installations" ("platform", "agentId");

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_schedules" (
              "id" TEXT PRIMARY KEY NOT NULL,
"target" JSONB NOT NULL,
"cron" TEXT NOT NULL,
"timezone" TEXT ,
"status" TEXT NOT NULL,
"next_fire_at" BIGINT NOT NULL,
"last_fire_at" BIGINT ,
"last_run_id" TEXT ,
"created_at" BIGINT NOT NULL,
"updated_at" BIGINT NOT NULL,
"metadata" JSONB ,
"owner_type" TEXT ,
"owner_id" TEXT 
            );
            
          
          

            CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_schedule_triggers" (
              "id" TEXT PRIMARY KEY NOT NULL,
"schedule_id" TEXT NOT NULL,
"run_id" TEXT ,
"scheduled_fire_at" BIGINT NOT NULL,
"actual_fire_at" BIGINT NOT NULL,
"outcome" TEXT NOT NULL,
"error" TEXT ,
"trigger_kind" TEXT NOT NULL,
"parent_trigger_id" TEXT ,
"metadata" JSONB 
            );
            
          
          
CREATE INDEX IF NOT EXISTS "agent_memory_idx_mastra_schedules_status_next_fire" ON "agent_memory"."mastra_schedules" ("status", "next_fire_at");
CREATE INDEX IF NOT EXISTS "agent_memory_idx_mastra_schedule_triggers_schedule_fire" ON "agent_memory"."mastra_schedule_triggers" ("schedule_id", "actual_fire_at" DESC);
-- mastra-framework-ddl:end
