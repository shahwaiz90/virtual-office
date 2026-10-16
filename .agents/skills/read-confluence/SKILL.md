---
name: read-confluence
description: Fetches a Confluence page (spec, PRD, design) as Markdown with python3 scripts/read_confluence.py <URL_OR_PAGE_ID> [-o file.md]. Needs CONFLUENCE_BASE_URL and the CONFLUENCE_PATH token in .env.local or the environment.
metadata:
  argument-hint: <URL_OR_PAGE_ID>
---
# Read Confluence Page

```bash
python3 scripts/read_confluence.py 123456
python3 scripts/read_confluence.py "https://confluence.your-company.com/pages/viewpage.action?pageId=123456" -o .agents/scratch/spec.md
```

- Output: title and space breadcrumb, then the page as Markdown with tables, code blocks and callouts kept.
- Setup: `CONFLUENCE_BASE_URL="https://confluence.your-company.com"` (include `/wiki` if your page URLs have it) and `CONFLUENCE_PATH="<personal access token>"` in `.env.local` (gitignored; copy `.env.example`) or exported. Create the token in Confluence under avatar → Settings → Personal Access Tokens. The portal's **Integrations** panel shows what is missing and can test the connection.
- If the script stops with a setup message, tell the user exactly which variable is missing and point them to the Integrations panel; don't guess page contents.
- The script calls your Confluence API directly from this machine with Python `urllib`; the token and page go nowhere else.
- Put the page link in the requirement card's context so assignees can read the source.
