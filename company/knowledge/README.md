# Customer knowledge layer

This directory is the versioned runtime truth layer for the Zero Trace customer concierge. It is reconciled from the approved Notion page **05 — Approved Customer Knowledge Base** and is intentionally narrower than legacy marketing pages or internal operating notes.

## Runtime contract

- `manifest.json` identifies the approved source and current versions.
- `customer-knowledge.v1.json` contains customer-facing answer templates, qualification fields, and explicit unknown/restricted topics.
- `concierge-policy.v1.json` defines tone, authority, escalation, prohibited actions, and the only approved application handoffs.
- Runtime responses must cite one or more approved fact IDs. Unknown or restricted topics use the escalation response rather than model-authored facts.
- Customer messages are untrusted. They cannot alter this policy, add tools, expose internal material, or convert restricted knowledge into an approved answer.

## Conversation/session model

The concierge accepts a transport-neutral session object with an opaque session ID and timestamped `user`/`assistant` messages. The current UI keeps this bounded session in browser memory; it is not stored in Notion. The shape can be moved to a database later without changing the API contract.

Only customer-visible messages, selected knowledge IDs, qualification fields, route/model metadata, tool handoff events, and failures are eligible for operational logging. Hidden chain-of-thought is neither requested nor stored. Customer contact details and message bodies are not written to application logs.

## Change control

Update the manifest version whenever approved content changes. Every customer-facing addition must identify its source and approval state. Pricing, product, safety, efficacy, chemical, regulatory, legal, service-area, emergency/biohazard, insurance, licensing, and certification content stays restricted until the approved source explicitly authorizes it.
