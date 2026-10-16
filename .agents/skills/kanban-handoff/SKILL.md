---
name: kanban-handoff
description: The single guide to the Kanban board API (http://localhost:3000), the only channel between agents. Read your card, register cards for work you hand on, talk on the card thread, publish your deliverable, and move cards with the status call.
---
# Kanban Handoff

Anyone reading only the board must see what was asked, who asked whom, what they said and what was delivered. Nothing important lives only in a delegation prompt or a reply. All calls are `curl -s` with `-H 'Content-Type: application/json'` on POSTs.

## 1. Receive: read the card
Your prompt only names a card ("Your task: WEB-311"). Read it:
```bash
curl -s "http://localhost:3000/api/tasks/WEB-311?format=md"
```
It holds your brief, acceptance criteria, context, parent, dependencies and thread. If a dependency is not `done`, say so on the thread and wait. If the brief is unclear, ask on the thread (`kind: "question"`). Then start:
```bash
curl -s -X POST localhost:3000/api/tasks/WEB-311/status -d '{"agentId":"web-dev","column":"in_progress","note":"Starting"}'
```
Started with a raw request instead of a card? Find or register its requirement card first (section 2), then work from the card.

## 2. Hand on: one card per piece of work
Rewrite the work for the receiver's role; never forward the text you were given.
- Scrum Master → Tech Lead: user need and why, scope, acceptance criteria in user terms, open questions.
- Tech Lead → Developer: technical contract: files, API shapes, data, edge cases, how to verify.
- Tech Lead → QA (only if on the roster): what to test, pass/fail criteria.

Register first (`parentKey` = the card you work from), then delegate:
```bash
curl -s -X POST localhost:3000/api/tasks/register -d '{"tasks":[{
  "key":"WEB-312","parentKey":"WEB-310","title":"Add GET /api/tasks/export.csv endpoint",
  "brief":"Add an Express route in server/index.js that streams the active sprint as CSV ...",
  "description":"Why this is needed.","acceptanceCriteria":["Returns text/csv with a header row"],
  "context":{"files":["server/index.js"],"decisions":["Columns agreed in WEB-311"]},
  "dependsOn":["WEB-311"],"assignedTo":"web-dev","delegatedBy":"web-tech-lead",
  "skill":"feature-implementation","column":"assigned"}]}'
```
- `key`: short prefix plus the next number above the highest key on the board. Unique.
- `type`: `requirement` for the user's request (one per request, owned by the orchestrator), otherwise `task`. The portal usually creates the requirement card when it watches your session: look for it with `GET /api/tasks?type=requirement&column=in_progress` before registering one.
- `brief` is recorded on the thread as your handoff message. `skill` must be one of the assignee's skills.

Delegate with only the card reference:
> Your task: **WEB-312**. Read it with `curl -s "http://localhost:3000/api/tasks/WEB-312?format=md"` and follow the kanban-handoff skill.

## 3. Work: talk on the thread
```bash
curl -s -X POST localhost:3000/api/tasks/WEB-312/thread -d '{"agentId":"web-dev","kind":"decision","text":"Streaming with res.write per row"}'
```
`kind`: `question`, `answer`, `update`, `decision` or `result`. Add `"to":"<agentId>"` to address someone. Answer questions on the same card.

## 4. Publish your deliverable
Whenever you hand on or finish, post what you produced before the status call. Posting again with the same `taskKey` and `type` updates it.

| Role | `type` | `content` |
| :--- | :--- | :--- |
| Scrum Master | `prd` | Need, scope, acceptance criteria, the cards created and their owners |
| Tech Lead | `architecture` or `code_review` | The technical contract; or review notes per acceptance criterion |
| Developer | `source_code` | What changed and why, every file, how each criterion is met, how you tested |
| QA | `test_report` | What was tested, results, defects |

```bash
curl -s -X POST localhost:3000/api/deliverables -d '{"taskKey":"WEB-312","agentId":"web-dev","type":"source_code",
  "title":"CSV export endpoint","summary":"GET /api/tasks/export.csv streams the sprint",
  "content":"## Changes\n- server/index.js: new route\n## Acceptance criteria\n- Header row: yes",
  "metadata":{"files":["server/index.js"]}}'
```
`taskKey` links it to the card; the server fills in the sprint, card link and `deliveredTo` (the card's delegator).

## 5. Finish: record the result and move the card
```bash
curl -s -X POST localhost:3000/api/tasks/WEB-312/status -d '{"agentId":"web-dev","column":"review","result":"Added /api/tasks/export.csv; 5 columns; tested with 40 tasks."}'
```
- Columns: `backlog`, `assigned`, `in_progress`, `review`, `testing`, `done`. Cards move only through this call; edits, commands and words in your reply never move them.
- `review` when someone must check it, `done` when nothing is left. With no tester on the roster, `testing` becomes `review`.
- A requirement closes by itself once all its sub-tasks are done, and a card waiting in `review` closes once all its own sub-tasks are done.

## 6. Hand back up
Moving to `review` hands the card to its delegator. A subagent cannot start another subagent, so end your reply with:
```
WEB-312 -> review, result on the card
HANDOFF WEB-312 -> web-tech-lead
```
Skip the HANDOFF line only for a card you delegated to yourself; then the reply goes to the user.

Reviewing a card you delegated: move it to `done`, or post what is missing, move it back to `in_progress` and end with `HANDOFF <KEY> -> <assignee>`.

## Rules
- No card, no handoff. Briefs are in your own words for the receiver's role, never the user's sentence pasted.
- Your final reply is a pointer to the card plus HANDOFF lines, not a second copy of the work.
- Server unreachable: write the same card into `.agents/sprints/<activeSprintId>/tasks.json` (active sprint is in `.agents/sprints/index.json`).
