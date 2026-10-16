---
name: read-jira
description: Fetches a Jira ticket (summary, description, acceptance criteria, subtasks, links) as Markdown with python3 scripts/read_jira.py <KEY_OR_URL> [-o file.md]. Needs the JIRA_PATH token in .env.local or the environment.
metadata:
  argument-hint: <TICKET_KEY_OR_URL>
---
# Read Jira Ticket

```bash
python3 scripts/read_jira.py DXDT-25243
python3 scripts/read_jira.py "https://dm.stc.com.sa/browse/DXDT-25243" -o .agents/scratch/DXDT-25243.md
```

- Output: key, status, priority, reporter/assignee, components and labels, description, acceptance criteria, subtasks and linked issues.
- Credentials: `JIRA_PATH="<personal access token>"` in `.env.local` (gitignored) or exported. Create one in Jira under avatar → Profile → Personal Access Tokens.
- The script calls the Jira API at `dm.stc.com.sa` directly from this machine with Python `urllib`; the token and ticket go nowhere else.
- Use the acceptance criteria as the starting point for `requirement-analysis`, and link the ticket key in the requirement card's description.
