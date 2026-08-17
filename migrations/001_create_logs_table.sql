-- Migration: 001_create_logs_table
-- Creates the partitioned logs table with optimized indexes

-- Create the partitioned logs table
CREATE TABLE IF NOT EXISTS logs (
    id          BIGINT GENERATED ALWAYS AS IDENTITY,
    timestamp   TIMESTAMPTZ     NOT NULL,
    level       SMALLINT        NOT NULL,  -- 0=debug, 1=info, 2=warn, 3=error
    service     TEXT            NOT NULL,
    message     TEXT            NOT NULL,
    attributes  JSONB,
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

-- Index for keyset pagination and ordering
CREATE INDEX IF NOT EXISTS idx_logs_timestamp_id
    ON logs (timestamp DESC, id DESC);

-- Index for service-filtered queries with keyset ordering
CREATE INDEX IF NOT EXISTS idx_logs_service_ts
    ON logs (service, timestamp DESC, id DESC);

-- Index for combined service and level filtered queries with keyset ordering
CREATE INDEX IF NOT EXISTS idx_logs_service_level_ts
    ON logs (service, level, timestamp DESC, id DESC);

-- Index for level-filtered queries with keyset ordering
CREATE INDEX IF NOT EXISTS idx_logs_level_ts
    ON logs (level, timestamp DESC, id DESC);

-- GIN index for JSONB attribute containment queries (attr.<key>=<value>)
CREATE INDEX IF NOT EXISTS idx_logs_attributes 
    ON logs USING GIN (attributes jsonb_path_ops)
    WITH (fastupdate = on, gin_pending_list_limit = 65536);

-- Trigram index for case-insensitive substring search on message (q=<text>)
CREATE INDEX IF NOT EXISTS idx_logs_message_trgm 
    ON logs USING GIN (message gin_trgm_ops)
    WITH (fastupdate = on, gin_pending_list_limit = 65536);

-- Migrations tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (version, name) 
VALUES (1, '001_create_logs_table')
ON CONFLICT (version) DO NOTHING;
