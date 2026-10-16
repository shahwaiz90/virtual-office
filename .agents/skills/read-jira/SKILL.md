---
name: read-jira
description: Fetches a Jira ticket (summary, description, acceptance criteria, subtasks, links) as Markdown with python3 scripts/read_jira.py <KEY_OR_URL> [-o file.md]. Needs JIRA_BASE_URL and the JIRA_PATH token in .env.local or the environment.
metadata:
  argument-hint: <TICKET_KEY_OR_URL>
---
# Read Jira Ticket

```bash
python3 scripts/read_jira.py PROJ-123
python3 scripts/read_jira.py "https://jira.your-company.com/browse/PROJ-123" -o .agents/scratch/PROJ-123.md
```

- Output: key, status, priority, reporter/assignee, components and labels, description, acceptance criteria, subtasks and linked issues.
- Setup: `JIRA_BASE_URL="https://jira.your-company.com"` and `JIRA_PATH="<personal access token>"` in `.env.local` (gitignored; copy `.env.example`) or exported. Create the token in Jira under avatar → Profile → Personal Access Tokens. The portal's **Integrations** panel shows what is missing and can test the connection.
- If the script stops with a setup message, tell the user exactly which variable is missing and point them to the Integrations panel; don't guess ticket contents.
- The script calls your Jira API directly from this machine with Python `urllib`; the token and ticket go nowhere else.
- Use the acceptance criteria as the starting point for `requirement-analysis`, and put the ticket key in the requirement card's description.
