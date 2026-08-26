# Zero Trace Solutions — Codex Engineering Contract

## Mission
Build and maintain the software that allows Zero Trace Solutions to operate as an AI-operated, human-delivered service business. The owner should primarily provide business guidance, approve exceptions/high-impact actions, and perform the physical sanitization service.

## Read first
Before changing business behavior, read:
- `company/company.yml`
- `company/permissions.yml`
- the relevant file under `company/workflows/`

These contracts outrank assumptions inferred from legacy website/database content.

## Critical business rule
Zero Trace Solutions is a **sanitization service**, not a cleaning company. Legacy cleaning language may exist in old data or documentation. Do not propagate it into new product behavior without explicit approval.

## Engineering responsibilities
- Implement approved workflows in small, testable increments.
- Keep Vercel production deployable.
- Treat Notion as the current operational record system.
- Treat Google Calendar as scheduling truth.
- Keep secrets in environment variables; never commit them.
- Add logs/receipts for meaningful automated external actions.
- Prefer deterministic business rules around AI judgment where possible.
- AI-generated customer claims must be grounded in approved company knowledge.
- Build failure states that stop safely instead of guessing.

## Authority
Codex may inspect code, implement scoped changes, add tests, improve internal architecture, and prepare deployable changes.

Codex must not invent company policy, pricing, legal commitments, sanitization efficacy/safety claims, or permissions. Material production/business-policy changes require owner approval.

## Phase 1 priority
Implement `company/workflows/lead-to-service.yml`.

Target closed loop:
website inquiry -> validated lead -> Notion -> AI qualification -> verified calendar availability -> customer-selected booking -> confirmation/reminders -> owner job brief -> service completion -> follow-up.

## Definition of done
A feature is not done merely because the UI exists. It must have:
1. durable records,
2. explicit authority boundary,
3. failure behavior,
4. logging for external effects,
5. tests or a repeatable verification path,
6. documentation when configuration/env vars change.
