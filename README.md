# Zero Trace Solutions — Website

Static multi-page site for Zero Trace Solutions (commercial sanitizing).

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
