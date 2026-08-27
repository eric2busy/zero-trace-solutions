# Zero Trace Solutions — Website

Static multi-page site for Zero Trace Solutions (commercial sanitizing).

## AI concierge

The customer concierge is available at `/concierge.html` and uses `POST /api/concierge`. The server routes intent and qualification through the OpenAI Responses API, but customer-facing business facts are rendered only from the approved, versioned files under `company/knowledge/`.

Required configuration:

- `OPENAI_API_KEY` — server-side only; never expose it to browser code.
- `OPENAI_CONCIERGE_MODEL` — optional; defaults to `gpt-5.4-mini`.

The model response is not stored by OpenAI (`store: false`). Application logs contain route/model metadata, approved knowledge IDs, handoff state, and failure categories—not customer message bodies, contact details, secrets, or hidden chain-of-thought. Lead, availability, and booking actions continue to use the existing `/api/leads`, `/api/availability`, and `/api/book` endpoints.

## Lead form → Notion

Walkthrough requests from `/book.html` POST to `/api/leads`, which creates a row in the Notion **Walkthrough Requests** database.

### One-time setup (required)

1. Create a Notion integration: https://www.notion.so/my-integrations  
   - Name: `Zero Trace Website`  
   - Type: Internal  
   - Copy the **Internal Integration Secret** (`ntn_...` or `secret_...`)

2. Share the database with the integration:  
   Open [Walkthrough Requests](https://app.notion.com/p/896228ea48af4523a8cb0f099ca800c2) → **•••** → **Connections** → connect **Zero Trace Website**.

3. In Vercel → Project → **Settings** → **Environment Variables**, add:

   | Name | Value |
   |------|-------|
   | `NOTION_TOKEN` | your integration secret |
   | `NOTION_DATABASE_ID` | `896228ea48af4523a8cb0f099ca800c2` |

   Apply to **Production** (and Preview if you want). Redeploy after saving.

### Local test

```bash
# With Vercel CLI and env vars set:
vercel dev
```

Then submit the form on http://localhost:3000/book.html
