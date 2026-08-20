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

-- Index for time-range queries with service/level filtering
-- This is the primary query pattern: filter by time, then by service/level
CREATE INDEX idx_logs_timestamp_service_level 
    ON logs (timestamp DESC, service, level);

-- Index for keyset pagination and ordering
CREATE INDEX idx_logs_timestamp_id
    ON logs (timestamp DESC, id DESC);

-- GIN index for JSONB attribute containment queries (attr.<key>=<value>)
CREATE INDEX idx_logs_attributes 
    ON logs USING GIN (attributes jsonb_path_ops);

-- Trigram index for case-insensitive substring search on message (q=<text>)
CREATE INDEX idx_logs_message_trgm 
    ON logs USING GIN (message gin_trgm_ops);

-- Migrations tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (version, name) 
VALUES (1, '001_create_logs_table')
ON CONFLICT (version) DO NOTHING;
