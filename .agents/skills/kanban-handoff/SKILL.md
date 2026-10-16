---
name: kanban-handoff
description: The Kanban board is the only channel between agents. Read your task from the board, write a rephrased, role-specific card for whoever you hand work to, and record every question, decision and result on the card's thread so anyone reading the board can follow the team.
---
# Kanban Handoff Protocol

The board (`http://localhost:3000`) is how this team talks. A person reading only the board must be able to see what was asked, who asked whom, what they said, and what was delivered. Nothing important may live only inside a private delegation prompt.

## 1. When you receive work: read the card, not the prompt
Your delegation message only names a card (e.g. "Your task: WEB-311"). Read it before doing anything:

```bash
curl -s "http://localhost:3000/api/tasks/WEB-311?format=md"
```

The card gives you the brief written for your role, acceptance criteria, context (files, decisions), the parent requirement, dependencies and the thread so far. If a dependency is not `done`, say so on the thread and wait. If the brief is unclear, ask on the thread (`kind: "question"`) instead of guessing.

Then move it to `in_progress`:

```bash
curl -s -X POST http://localhost:3000/api/tasks/WEB-311/status \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"web-dev","column":"in_progress","note":"Starting on the export endpoint"}'
```

## 2. When you hand work on: rephrase it for the next role
Never forward the text you were given. Rewrite it for the receiver's job:
- **Scrum Master → Tech Lead:** what the user needs and why, scope, acceptance criteria in user terms, open questions.
- **Tech Lead → Developer:** the technical contract: files/components to touch, API shapes, data model, edge cases, how to verify.
- **Tech Lead → QA (if on the roster):** what to test, environments, pass/fail criteria.

Register the card first, with `parentKey` pointing at the card you are working from, then delegate:

```bash
curl -s -X POST http://localhost:3000/api/tasks/register \
  -H 'Content-Type: application/json' \
  -d '{"tasks":[{
    "key": "WEB-312",
    "parentKey": "WEB-310",
    "title": "Add GET /api/tasks/export.csv endpoint",
    "brief": "Add an Express route in server/index.js that streams the active sprint tasks as CSV ...",
    "description": "Why this is needed and how it fits the requirement.",
    "acceptanceCriteria": ["Returns text/csv with a header row", "Includes key, title, assignee, column"],
    "context": {"files": ["server/index.js", "server/watchers.js"], "decisions": ["Columns agreed in WEB-311"]},
    "dependsOn": ["WEB-311"],
    "assignedTo": "web-dev",
    "delegatedBy": "web-tech-lead",
    "skill": "feature-implementation",
    "column": "assigned"
  }]}'
```

The `brief` is recorded on the thread as your handoff message. Then invoke the subagent with only the card reference:

> Your task: **WEB-312**. Read it with `curl -s "http://localhost:3000/api/tasks/WEB-312?format=md"`, follow the kanban-handoff skill, and report back on the card.

## 3. While you work: talk on the thread
Post to the card instead of keeping things in your head or your reply:

```bash
curl -s -X POST http://localhost:3000/api/tasks/WEB-312/thread \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"web-dev","kind":"decision","text":"Using res.write per row so large sprints stream"}'
```

`kind` is one of `question`, `answer`, `update`, `decision`, `result`. Add `"to": "<agentId>"` when you address someone. Answer questions on the same card.

## 4. When you finish: record the result, move the card
State what you did, the files you changed, and how each acceptance criterion is met:

```bash
curl -s -X POST http://localhost:3000/api/tasks/WEB-312/status \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"web-dev","column":"review","result":"Added /api/tasks/export.csv in server/index.js; streams 5 columns; tested with 40 tasks."}'
```

Move to `review` when someone must check it, `done` when nothing is left. The delegator reviews on the card and either moves it to `done` or posts what is missing and moves it back to `in_progress`.

## 5. Publish your deliverable
Every time you hand work on (step 2) or finish (step 4), post what you produced to the Deliverables Hub, so the portal shows each role's artifact next to the board. Do it before the status call. Post one deliverable per card and type; posting again with the same `taskKey` and `type` updates it.

| Role | `type` | What goes in `content` |
| :--- | :--- | :--- |
| Scrum Master | `prd` | Requirement breakdown: the user need, scope, acceptance criteria, the cards you created and who owns each |
| Tech Lead | `architecture` (contract) or `code_review` (review of a card you delegated) | Technical contract: files, API shapes, data model, edge cases, how to verify; or review notes per acceptance criterion |
| Developer | `source_code` | Implementation summary: what changed and why, every changed file, how each acceptance criterion is met, how you tested |
| QA | `test_report` | What was tested, results, defects |

```bash
curl -s -X POST http://localhost:3000/api/deliverables \
  -H 'Content-Type: application/json' \
  -d '{"taskKey":"WEB-312","agentId":"web-dev","type":"source_code",
    "title":"CSV export endpoint",
    "summary":"GET /api/tasks/export.csv streams the active sprint as CSV",
    "content":"## Changes\n- server/index.js: new route ...\n## Acceptance criteria\n- Header row: yes ...",
    "metadata":{"files":["server/index.js"]}}'
```

`taskKey` links the deliverable to the card: the server fills in the sprint, the card link, and `deliveredTo` (the card's "Delegated by" agent, `user` for your own card, or the assignee when you post review notes on a card you delegated). Pass `deliveredTo` or `sprintId` yourself only to override them. If you record a `result` without posting a deliverable, the server files a minimal one from the card; post your own so the hub carries the real artifact.

## 6. Hand the card back up
Moving a card to `review` is a handoff to whoever delegated it. A subagent cannot start another subagent, so end your reply with the card's "Delegated by" agent:

```
WEB-312 -> review, result on the card
HANDOFF WEB-312 -> web-tech-lead
```

Skip the line only when you delegated the card to yourself (e.g. the Scrum Master's own requirement card); then the reply goes to the user.

When you review a card you delegated: move it to `done` (and, if that finishes your own card, move yours to `review` and hand it up the same way), or post what is missing, move it back to `in_progress` and end with `HANDOFF <its KEY> -> <its assignee>`.

## Rules
- One card per piece of work you hand on; no card, no handoff.
- Briefs are written for the receiver's role, in your own words, from the requirement and the code. Never paste the user's sentence or your own brief as the next brief.
- Your final reply to whoever invoked you is a short pointer to the card (`WEB-312 → review, result on the card`) plus any HANDOFF lines (down to new cards, or up to your delegator when your card is in review), not a second copy of the work.
- If the server is not reachable, write the same card into `.agents/sprints/<activeSprintId>/tasks.json` (active sprint is in `.agents/sprints/index.json`).
