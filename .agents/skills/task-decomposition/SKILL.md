---
name: task-decomposition
description: Breaks the user's actual requirement into the specific tasks it needs (no fixed template, no fixed count), registers them on the Kanban board, then delegates each task to the right specialist from the team roster.
---
# Task Decomposition & Team Assignment

Use this skill whenever the user gives a requirement (feature, change, bug, idea). Your job is to **think about that specific requirement** and produce the tasks it really needs. Nothing about the breakdown is fixed in advance.

## 0. Backlog-First Policy (PM Rule)
- Register every new requirement on the board in `backlog` immediately, even if the team is busy.
- Never interrupt tasks that are `assigned`, `in_progress`, `review` or `testing`. Pull the next backlog item (FIFO) only when the active work is `done`.

## 1. Golden Rules — NO HARDCODING
1. **No fixed template.** Do NOT always produce "Plan / Build / Review / Test", and do NOT always produce 4 tasks. A one-line bug fix may be 1 task; a large feature may be 8+. The number and kind of tasks come from the requirement.
2. **Titles and descriptions come from the requirement.** Each title names the concrete piece of work (e.g. "Add sprint picker to Kanban header", "Persist task order in tasks.json"). Never use generic placeholders ("Task 1", "Implementation", "Core Feature", "Step 2") and never paste the user's sentence as a title.
3. **Never hardcode tasks in source code.** Tasks are runtime data. Do not write task lists, keyword→title maps, stage templates, or "fallback" demo tasks into `server/`, `src/` or tests. If you are asked to change how tasks are created, the code must pass through what the agent/AI produced — not generate its own.
4. **Assign from the real roster.** Read `.agents/agents.json` (or `.agents/registry.yaml`). Pick each assignee by its role, skills and `prohibited_actions`, and only along permitted `delegation_targets`. Never assign to an agent that does not exist (e.g. a `web-tester` that isn't in the roster). If no suitable role exists, assign to the closest permitted agent and say so in the description.
5. **Review/test tasks only when they add value** and someone on the roster is allowed to do them — not by default.

## 2. How to Break Down a Requirement
0. Make sure the user's requirement itself is one card with `"type": "requirement"` (assigned to you, the orchestrator). When the portal watches the session it has already created it: find it with `curl -s "http://localhost:3000/api/tasks?type=requirement&column=in_progress"` and use its `key`. Only register a new requirement card if none matches. Every task below points to it with `parentKey`, so the board shows which tasks serve which request.
1. Restate the requirement in one sentence and list what "done" means for the user (acceptance criteria).
2. Look at the codebase to find what actually has to change (files, APIs, UI, data).
3. Split the work into independent, verifiable tasks — each small enough for one specialist to finish and check.
4. Order them and note dependencies (`dependsOn`).
5. Assign each task (rule 4).
6. Write each task's `brief` **for the role that receives it**, in your own words (see the `kanban-handoff` skill): what this role must deliver, the scope it owns, and how it will know it is done. A Tech Lead gets the product intent and constraints; a Developer gets the technical contract (files, APIs, data, edge cases).

## 3. Task Schema
```json
{
  "key": "WEB-214",
  "type": "task",
  "parentKey": "WEB-210",
  "title": "Add sprint picker to Kanban header",
  "brief": "Instructions written for the assignee's role: what to build, where, and how to verify it.",
  "description": "Why this task exists and how it serves the requirement.",
  "acceptanceCriteria": ["Picker lists all sprints", "Switching reloads tasks"],
  "context": { "files": ["src/components/KanbanBoard.tsx"], "decisions": ["Reuse GET /api/sprints"] },
  "assignedTo": "web-dev",
  "delegatedBy": "tech-pm",
  "column": "backlog",
  "skill": "feature-implementation",
  "dependsOn": ["WEB-213"],
  "progress": 0
}
```
- `type`: `requirement` for the user's request, `task` for work items.
- `parentKey`: the card this task was broken out of (the requirement, or a Tech Lead's own task).
- `brief`: the handoff message to the assignee; it is recorded on the card's thread.
- `context`: files, decisions and links the assignee needs, so it never has to ask you for them.
- `key`: unique; use a short prefix plus the next number after the highest key already on the board.
- `title`: plain English, specific, under ~60 characters.
- `column`: `backlog` for new work; the task you are delegating right now becomes `in_progress`.
- `skill`: one of the assignee's actual skills.

## 4. Register on the Kanban, THEN Delegate
1. Register all tasks first, so they are visible before work starts:
   - `POST http://localhost:3000/api/tasks/register` with `{ "tasks": [ ... ] }`, or
   - write them into `.agents/sprints/<activeSprintId>/tasks.json` (active sprint is in `.agents/sprints/index.json`).
2. Then delegate each task with `invoke_subagent` / `send_message` (or the Agent tool in Claude Code) using **only the card reference**, e.g. "Your task: WEB-214. Read it with `curl -s "http://localhost:3000/api/tasks/WEB-214?format=md"` and follow the kanban-handoff skill." The card is the instruction; do not repeat it in the prompt.
3. Follow progress on the board, not in replies: read the card's thread and result (`GET /api/tasks/<key>`), answer questions there, and move cards with `POST /api/tasks/<key>/status`.
4. When every task under the requirement is `done`, post a summary on the requirement card's thread and move it to `done`.

## 5. Example — two requirements, two different breakdowns
- "Fix the typo in the Settings modal title" → 1 task: `WEB-301 Fix typo in Settings modal title` → `web-dev`.
- "Let users export the Kanban board as CSV" → e.g. `WEB-310 Define CSV columns for task export` (`web-tech-lead`), `WEB-311 Add GET /api/tasks/export.csv endpoint` (`web-dev`), `WEB-312 Add Export button to Kanban header` (`web-dev`), `WEB-313 Review export output and edge cases` (`web-tech-lead`).

These are illustrations of the *approach* — never copy them as a template.
