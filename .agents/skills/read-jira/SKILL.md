---
name: read-jira
description: Fetches full Jira ticket details (issue key, summary, description, acceptance criteria, subtasks, linked PRs/issues) into clean Markdown. Run python3 scripts/read_jira.py <TICKET_KEY> [-o output.md]. Requires JIRA_PATH personal access token in .env.local or environment.
metadata:
  author: AI Agent Virtual Office
  version: "1.0.0"
  argument-hint: <TICKET_KEY_OR_URL>
---

# Read Jira Ticket

Fetches Jira tickets and technical specifications directly into structured Markdown so the Product Manager, Tech Lead, and developers can extract acceptance criteria and breakdown sprint deliverables.

## 🔒 Security & Privacy Notice
- **100% Local Execution**: The script runs entirely on your local machine using standard Python `urllib` to query your enterprise Jira API directly (`dm.stc.com.sa`).
- **Zero Third-Party Transmission**: Your personal access token (`JIRA_PATH`) and ticket data are **NEVER** sent to any external server, AI model provider, or telemetry service.
- **Git Safety**: Store credentials in `.env.local` which is permanently excluded by `.gitignore`.

## Setup & Credentials

Set your Personal Access Token in `.env.local` in the project root:
```bash
JIRA_PATH="your_personal_access_token_here"
```
Or export it in your shell environment:
```bash
export JIRA_PATH="your_personal_access_token_here"
```

## How to Obtain a Jira Personal Access Token (PAT)
1. In Jira, click your user avatar in the top right corner.
2. Select **Profile** -> **Personal Access Tokens**.
3. Click **Create token**, assign a descriptive name (e.g. `VirtualOffice-Agent`), and copy the generated token.

## Command Usage

```bash
# Read a ticket key directly:
python3 scripts/read_jira.py DXDT-25243

# Read from a full Jira URL:
python3 scripts/read_jira.py "https://dm.stc.com.sa/browse/DXDT-25243"

# Save markdown output to a file:
python3 scripts/read_jira.py DXDT-25243 -o .agents/scratch/DXDT-25243.md
```

## Output Structure
The generated markdown includes:
- **Key & Summary**: Issue identifier, status, priority, reporter, and assignee.
- **Components & Labels**: Target architectures and feature tags.
- **Description**: Rendered user story with technical details and tables.
- **Acceptance Criteria**: Extracted bullet points for definition of done.
- **Subtasks & Linked Issues**: Blocking or dependency relationships.
