---
name: kanban-handoff
description: The single guide to the Kanban board API (the portal's address is in .agents/portal-url), the only channel between agents. Start your card, register cards for work you hand on, talk on the card thread, and finish with your result and deliverable in one call.
---
# Kanban Handoff

Anyone reading only the board must see what was asked, who asked whom, what they said and what was delivered. Nothing important lives only in a delegation prompt or a reply. Your role prompt has the everyday calls; this skill adds the rules and edge cases.

Start every command with `VO=$(cat .agents/portal-url 2>/dev/null || echo http://localhost:3000);` (the running portal writes its address there) and call `$VO/api/...` with `curl -s`. POST bodies are JSON; no Content-Type header is needed.

## 1. Start your card
Your prompt only names a card ("Your task: WEB-311"). One call moves it to `in_progress` and prints it (brief, acceptance criteria, context, sub-tasks, deliverables, latest thread):
```bash
VO=$(cat .agents/portal-url 2>/dev/null || echo http://localhost:3000); curl -s -X POST $VO/api/tasks/WEB-311/start -d '{"agentId":"web-dev"}'
```
- A dependency that is not `done` keeps the card where it is, and the first line says so: say so on the thread and stop.
- On a card you delegated (to review it), the same call only prints it.
- Re-read: `curl -s "$VO/api/tasks/WEB-311?format=brief"`. Full thread and all fields: `?format=md`. A deliverable listed on the card: `curl -s $VO/api/deliverables/<id>`.
- Brief unclear? Ask on the thread (`kind: "question"`) before you build.
- Started with a raw request instead of a card? Find or register its requirement card first (section 2).

## 2. Hand on: one card per piece of work
Rewrite the work for the receiver's role; never forward the text you were given.
- Scrum Master → Tech Lead: user need and why, scope, acceptance criteria in user terms, open questions.
- Tech Lead → Developer: technical contract: files, API shapes, data, edge cases, how to verify.
- Tech Lead → QA (only if on the roster): what to test, pass/fail criteria.

Register (`parentKey` = the card you work from), then delegate:
```bash
VO=$(cat .agents/portal-url 2>/dev/null || echo http://localhost:3000); curl -s -X POST "$VO/api/tasks/register?format=brief" -d '{"tasks":[{
  "key":"WEB-312","parentKey":"WEB-310","title":"Add GET /api/tasks/export.csv endpoint",
  "brief":"Add an Express route in server/index.js that streams the active sprint as CSV ...",
  "description":"Why this is needed.","acceptanceCriteria":["Returns text/csv with a header row"],
  "context":{"files":["server/index.js"],"decisions":["Columns agreed in WEB-311"]},
  "dependsOn":["WEB-311"],"assignedTo":"web-dev","delegatedBy":"web-tech-lead",
  "skill":"feature-implementation","column":"assigned"}]}'
```
- `key`: short prefix plus the next number above the highest key on the board (`curl -s "$VO/api/tasks?format=brief"` lists them). Unique.
- `type`: `requirement` for the user's request (one per request, owned by the orchestrator), otherwise `task`. The portal usually registers the requirement card when it watches your session: look with `curl -s "$VO/api/tasks?type=requirement&format=brief"` before registering one.
- `brief` is recorded on the thread as your handoff message. `skill` must be one of the assignee's skills.

Delegate with only the card reference:
> Your task: **WEB-312**. Start it with `curl -s -X POST "$(cat .agents/portal-url 2>/dev/null || echo http://localhost:3000)/api/tasks/WEB-312/start"` (prints the card), then follow your role prompt.

## 3. Work: talk on the thread
```bash
VO=$(cat .agents/portal-url 2>/dev/null || echo http://localhost:3000); curl -s -X POST "$VO/api/tasks/WEB-312/thread?format=brief" -d '{"agentId":"web-dev","kind":"decision","text":"Streaming with res.write per row"}'
```
`kind`: `question`, `answer`, `update`, `decision` or `result`. Add `"to":"<agentId>"` to address someone. Answer questions on the same card.

## 4. Finish: deliverable, result and move in one call
```bash
VO=$(cat .agents/portal-url 2>/dev/null || echo http://localhost:3000); curl -s -X POST $VO/api/tasks/WEB-312/finish -d '{"agentId":"web-dev",
  "result":"Added /api/tasks/export.csv; 5 columns; tested with 40 tasks.",
  "deliverable":{"type":"source_code","title":"CSV export endpoint","summary":"GET /api/tasks/export.csv streams the sprint",
    "content":"## Changes\n- server/index.js: new route\n## Acceptance criteria\n- Header row: yes","metadata":{"files":["server/index.js"]}}}'
```
| Role | deliverable `type` | `content` |
| :--- | :--- | :--- |
| Scrum Master | `prd` | Need, scope, acceptance criteria, the cards created and their owners |
| Tech Lead | `architecture` or `code_review` | The technical contract; or review notes per acceptance criterion |
| Developer | `source_code` | What changed and why, every file, how each criterion is met, how you tested |
| QA | `test_report` | What was tested, results, defects |

- The column defaults to `review` for a card someone delegated to you and `done` for a card you own; pass `"column"` to choose. Columns: `backlog`, `assigned`, `in_progress`, `review`, `testing`, `done`. With no tester on the roster, `testing` becomes `review`.
- Cards move only through the board API; edits, commands and words in your reply never move them.
- Finishing again with the same deliverable `type` updates it. The server links it to the card, sprint and delegator.
- A requirement closes by itself once all its sub-tasks are done, and a card waiting in `review` closes once all its own sub-tasks are done.
- The older calls still work: `POST /api/tasks/<KEY>/status` (`column`, `note`, `result`) and `POST /api/deliverables` (`taskKey`, `type`, `title`, `content`). Board replies are short; `?format=full` returns the whole card or office state.

## 5. Hand back up
Finishing in `review` hands the card to its delegator. A Claude Code subagent cannot start another subagent, so it ends its reply with:
```
WEB-312 -> review, result on the card
HANDOFF WEB-312 -> web-tech-lead
```
Skip the HANDOFF line only for a card you delegated to yourself; then the reply goes to the user.

Reviewing a card you delegated: finish it with `"column":"done"`, or `"column":"in_progress"` with what is missing in `note` (then `HANDOFF <KEY> -> <assignee>` where HANDOFF lines apply).

## Rules
- No card, no handoff. Briefs are in your own words for the receiver's role, never the user's sentence pasted.
- Your final reply is a pointer to the card plus HANDOFF lines, not a second copy of the work.
- Server unreachable: write the same card into `.agents/sprints/<activeSprintId>/tasks.json` (active sprint is in `.agents/sprints/index.json`).
