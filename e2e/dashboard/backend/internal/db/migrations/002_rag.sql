-- ─────────────────────────────────────────────────────────────────────────────
-- Scout QA Platform — Migration 002: AI / RAG Tables
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────
-- BOT CONFIGURATION (per org)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bot_configs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  system_prompt   TEXT,
  model           TEXT        DEFAULT 'llama-3.3-70b-versatile',
  temperature     FLOAT       DEFAULT 0.7,
  max_tokens      INTEGER     DEFAULT 2048,
  rag_enabled     BOOLEAN     DEFAULT TRUE,
  custom_settings JSONB       DEFAULT '{}',
  updated_by      UUID        REFERENCES users(id),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- RAG DOCUMENT STORE (pgvector)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rag_documents (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_type TEXT        NOT NULL CHECK (source_type IN ('test_case','run_report','run_error','manual')),
  source_id   UUID,                            -- FK to the originating record (flexible)
  content     TEXT        NOT NULL,            -- chunked plain text
  embedding   vector(1536),                    -- Groq embedding vector
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- IVFFlat index for fast approximate nearest-neighbour cosine similarity search.
-- lists=100 is a good default for up to ~1M rows; rebuild with more lists as data grows.
CREATE INDEX IF NOT EXISTS idx_rag_embedding
  ON rag_documents
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_rag_org        ON rag_documents (org_id);
CREATE INDEX IF NOT EXISTS idx_rag_source     ON rag_documents (source_type, source_id);
