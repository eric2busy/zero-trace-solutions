# Zero Trace Solutions — Codex Engineering Contract

## Mission

Build and maintain the software that allows Zero Trace Solutions to operate as an AI-operated, human-delivered service business. The owner should primarily provide business guidance, approve exceptions/high-impact actions, and perform the physical sanitization service.

## Instruction priority and required reading

Before starting any issue, read, in order:

1. this `AGENTS.md` in full;
2. every applicable rule in `company/`, including `company/company.yml`, `company/permissions.yml`, and `company/engineering-worker-os.md`;
3. the relevant file under `company/workflows/`;
4. the assigned GitHub issue, its comments, linked dependencies, and acceptance criteria.

More specific instructions may narrow authority but may not expand it. Company contracts outrank assumptions inferred from legacy website, database, or issue content. If instructions conflict or required context is missing, stop and use the blocker format in `company/engineering-worker-os.md`.

## Critical business rule

Zero Trace Solutions is a **sanitization service**, not a cleaning company. Legacy cleaning language may exist in old data or documentation. Do not propagate it into new product behavior without explicit approval.

## GitHub is the engineering work queue

GitHub Issues are the source of truth for engineering tasks. Work on one claimed issue at a time. Do not begin implementation from an informal request unless it is represented by a Codex-ready issue or the owner explicitly authorizes the work in the current task.

Follow the complete lifecycle, status rules, naming conventions, escalation format, and handoff requirements in `company/engineering-worker-os.md`:

`Queued -> In Progress -> Blocked | Review -> Done`

A worker is expected to proceed independently from claim through tested pull request. Routine implementation choices within the issue scope do not require owner confirmation.

## Engineering responsibilities

- Implement approved workflows in small, testable increments.
- Keep Vercel production deployable.
- Treat Notion as the current operational record system.
- Treat Google Calendar as scheduling truth.
- Keep secrets in environment variables; never commit them or expose them in logs.
- Add logs or receipts for meaningful automated external actions without exposing customer data.
- Prefer deterministic business rules over AI judgment where possible.
- Ground AI-generated customer claims in approved company knowledge.
- Build failure states that stop safely instead of guessing.
- Preserve unrelated user work and avoid opportunistic scope expansion.

## Authority and approval boundaries

Codex may autonomously inspect code, claim a ready issue, create a branch, implement scoped changes, add tests, update documentation, run local verification, push a branch, and prepare a pull request.

Codex must not invent company policy, pricing, legal commitments, sanitization efficacy or safety claims, or permissions. A worker must stop before performing an approval-required action. Approval is explicit, task-specific, and cannot be inferred from silence, a previous approval, or the existence of an issue.

Owner approval is required before:

- merging a consequential change;
- deploying or promoting any change to production;
- changing production configuration, DNS, environment variables, credentials, or secrets;
- sending nonstandard external communications or triggering material external side effects;
- changing company policy, pricing, legal commitments, permissions, or customer-facing safety/efficacy claims;
- deleting material business data or performing an irreversible migration;
- bypassing tests, branch protection, required review, or another safety control.

Workers never self-approve. Unless the issue explicitly grants narrower merge authority consistent with company policy, leave the PR in `Review` for a human. Do not add or enable auto-merge, auto-deploy, or branch-protection bypasses.

## Phase 1 priority

Implement `company/workflows/lead-to-service.yml`.

Target closed loop:
website inquiry -> validated lead -> Notion -> AI qualification -> verified calendar availability -> customer-selected booking -> confirmation/reminders -> owner job brief -> service completion -> follow-up.

## Definition of done

A feature is not done merely because the UI exists. It must have:

1. durable records;
2. an explicit authority boundary;
3. safe failure behavior;
4. logging for external effects;
5. tests or a repeatable verification path;
6. documentation when configuration or environment variables change;
7. all issue acceptance criteria checked;
8. a reviewed and merged PR, with any required approval recorded.
