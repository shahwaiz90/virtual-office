---
name: read-confluence
description: Fetches a Confluence page (spec, PRD, design) as Markdown with python3 scripts/read_confluence.py <URL_OR_PAGE_ID> [-o file.md]. Needs the CONFLUENCE_PATH token in .env.local or the environment.
metadata:
  argument-hint: <URL_OR_PAGE_ID>
---
# Read Confluence Page

```bash
python3 scripts/read_confluence.py 421200037
python3 scripts/read_confluence.py "https://dm.stc.com.sa/wiki/pages/viewpage.action?pageId=421200037" -o .agents/scratch/spec.md
```

- Output: title and space breadcrumb, then the page as Markdown with tables, code blocks and callouts kept.
- Credentials: `CONFLUENCE_PATH="<personal access token>"` in `.env.local` (gitignored) or exported. Create one in Confluence under avatar → Settings → Personal Access Tokens.
- The script calls the Confluence API at `dm.stc.com.sa/wiki` directly from this machine with Python `urllib`; the token and page go nowhere else.
- Put the page link in the requirement card's context so assignees can read the source.
