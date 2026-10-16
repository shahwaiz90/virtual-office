---
name: read-confluence
description: Fetches Confluence wiki specifications, PRDs, architectural designs, and documentation into clean Markdown. Run python3 scripts/read_confluence.py <URL_OR_PAGE_ID> [-o output.md]. Requires CONFLUENCE_PATH personal access token in .env.local or environment.
metadata:
  author: AI Agent Virtual Office
  version: "1.0.0"
  argument-hint: <URL_OR_PAGE_ID>
---

# Read Confluence Wiki Page

Fetches Confluence specifications, PRDs, UX guidelines, and architectural contracts into clean, readable Markdown for product scoping and task decomposition.

## 🔒 Security & Privacy Notice
- **100% Local Execution**: The script runs entirely on your local machine using standard Python `urllib` to query your enterprise Confluence API directly (`dm.stc.com.sa/wiki`).
- **Zero Third-Party Transmission**: Your personal access token (`CONFLUENCE_PATH`) and document content are **NEVER** sent to any external server, AI model provider, or telemetry service.
- **Git Safety**: Store credentials in `.env.local` which is permanently excluded by `.gitignore`.

## Setup & Credentials

Set your Personal Access Token in `.env.local` in the project root:
```bash
CONFLUENCE_PATH="your_personal_access_token_here"
```
Or export it in your shell environment:
```bash
export CONFLUENCE_PATH="your_personal_access_token_here"
```

## How to Obtain a Confluence Personal Access Token (PAT)
1. In Confluence, click your user avatar in the top right corner.
2. Select **Settings** -> **Personal Access Tokens** (or **Profile** -> **Personal Access Tokens**).
3. Click **Create token**, assign a name (e.g. `VirtualOffice-Agent`), and copy the token.

## Command Usage

```bash
# Read via Confluence page URL:
python3 scripts/read_confluence.py "https://dm.stc.com.sa/wiki/pages/viewpage.action?pageId=421200037"

# Read via numeric Page ID:
python3 scripts/read_confluence.py 421200037

# Save markdown output to file:
python3 scripts/read_confluence.py 421200037 -o .agents/scratch/spec.md
```

## Output Structure
The generated markdown includes:
- **Page Title & Breadcrumb metadata**: Space name and document hierarchy.
- **Formatted PRD Sections**: Clean Markdown conversion of wiki markup and HTML.
- **Code & Diagrams**: Preserved code snippets, tables, note callouts, and technical specs.
