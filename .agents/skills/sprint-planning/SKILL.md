---
name: sprint-planning
description: Sequences the requirement's tasks on the board by real dependencies, keeps the backlog FIFO, and manages sprint folders and the sprint APIs.
---
# Sprint Planning

Break work down with `task-decomposition`; move cards with `kanban-handoff`. This skill covers order and sprints.

## Sequencing
- Order by `dependsOn`. Tasks with no dependency between them can run in parallel when different agents own them.
- Balance work across the roster; don't queue everything on one agent.
- Every request enters `backlog` first, even when the team is idle. Never preempt active cards; pull the next backlog item when active work is `done`.

## Sprints
- `.agents/sprints/index.json` lists sprints and points to `activeSprintId`. Each sprint folder `.agents/sprints/<sprintId>/` holds `tasks.json` (the board), `sprint-plan.md` and `assets/`. These folders are local runtime data and are not committed.
- `GET /api/sprints`: active sprint and the list.
- `POST /api/sprints/start`: create the next sprint folder, make it active, clear the board.
- `POST /api/sprints/switch` with `{"sprintId":"sprint-3"}`: make another sprint active and load its cards.
- The portal starts a new sprint by itself when a new request arrives and every card on the board is `done`.
