CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Transcription_user_createdAt_idx"
  ON "Transcription" ("userId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Transcription_user_actualDate_idx"
  ON "Transcription" ("userId", "actualDate" DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS "Transcription_fileName_trgm_idx"
  ON "Transcription" USING GIN ("fileName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Transcription_topic_trgm_idx"
  ON "Transcription" USING GIN ("topic" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Transcription_organization_trgm_idx"
  ON "Transcription" USING GIN ("organization" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Transcription_speaker_trgm_idx"
  ON "Transcription" USING GIN ("speaker" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Transcription_industry_trgm_idx"
  ON "Transcription" USING GIN ("industry" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Transcription_intermediary_trgm_idx"
  ON "Transcription" USING GIN ("intermediary" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Transcription_search_metadata_trgm_idx"
  ON "Transcription"
  USING GIN ((
    coalesce("fileName", '') || ' ' ||
    coalesce("topic", '') || ' ' ||
    coalesce("organization", '') || ' ' ||
    coalesce("intermediary", '') || ' ' ||
    coalesce("industry", '') || ' ' ||
    coalesce("country", '') || ' ' ||
    coalesce("participants", '') || ' ' ||
    coalesce("eventDate", '') || ' ' ||
    coalesce("speaker", '') || ' ' ||
    coalesce("tags", '')
  ) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Transcription_search_summary_trgm_idx"
  ON "Transcription"
  USING GIN ((
    coalesce("summary", '') || ' ' ||
    coalesce("translatedSummary", '')
  ) gin_trgm_ops);
