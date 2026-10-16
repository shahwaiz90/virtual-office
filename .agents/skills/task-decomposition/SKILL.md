---
name: task-decomposition
description: Breaks the user's actual requirement into the tasks it needs (no fixed template or count) and assigns each to the right role on the roster. Board calls are in the kanban-handoff skill.
---
# Task Decomposition

Use for every requirement (feature, change, bug, idea). Think about that specific request; nothing about the breakdown is fixed in advance. Register and delegate the cards with the `kanban-handoff` skill.

## Rules
1. **No template.** Never default to Plan/Build/Review/Test or to a fixed count. A typo fix is 1 task; a large feature may be 8+.
2. **Specific titles** under ~60 characters naming the work ("Add sprint picker to Kanban header"). No "Task 1", "Implementation", "Core Feature", and never the user's sentence pasted.
3. **Tasks are runtime data.** Never write task lists, keyword→title maps, stage templates or fallback tasks into `server/`, `src/` or tests.
4. **Assign from the real roster** (`.agents/agents.json`): by role, skills and `prohibited_actions`, along `delegation_targets` only. Never assign to an agent that doesn't exist; if no role fits, use the closest permitted one and say so in the description.
5. **Review/test tasks only when they add value** and a roster agent may do them.
6. **Backlog first.** New requirements go to `backlog`. Don't interrupt cards in `assigned`, `in_progress`, `review` or `testing`; pull the next backlog item (FIFO) when active work is `done`.

## Steps
1. Use the request's requirement card as the parent of every task (kanban-handoff §2).
2. Restate the requirement in one sentence and list what "done" means for the user.
3. Read the code to find what actually has to change.
4. Split into independent, verifiable tasks, each small enough for one specialist; record order in `dependsOn`.
5. Assign each task, and write each `brief` for the role receiving it: the Tech Lead gets product intent and constraints, the Developer gets the technical contract.
6. Register all cards, then delegate each by card key. Follow progress on the board, not in replies. The requirement closes itself when every sub-task is `done`; post a summary on its thread.

## Example breakdowns (illustrations, not a template)
- "Fix the typo in the Settings modal title" → `WEB-301 Fix typo in Settings modal title` → web-dev.
- "Export the board as CSV" → `WEB-310 Define CSV columns` (web-tech-lead), `WEB-311 Add GET /api/tasks/export.csv` (web-dev, dependsOn WEB-310), `WEB-312 Add Export button to Kanban header` (web-dev, dependsOn WEB-311).
