-- PREPARED FOR PR REVIEW ONLY. Do not apply to any Supabase project without
-- separate explicit owner approval. Kept separate because PostgreSQL requires
-- an enum addition to commit before a following function may use it.

alter type public.command_job_operation_kind add value if not exists 'schedule';
