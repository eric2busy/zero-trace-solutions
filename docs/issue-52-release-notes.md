# Issue #52 — website lead → Command mirror

This slice preserves the existing Notion-first walkthrough intake and email behavior.

After a Notion page is successfully created, `/api/leads` attempts a server-only best-effort mirror into the existing Supabase Command schema. It reuses a customer by normalized email (phone fallback), adds contact rows, and creates an unscheduled draft walkthrough job reconciled by the Notion page ID.

If Command/Supabase is unavailable, the website intake remains successful and returns `commandSync: pending`. No Calendar event is created or modified, no schema migration is included, and no browser receives a Supabase secret.

Production remains gated by exact-head owner approval after Preview/CI review.
