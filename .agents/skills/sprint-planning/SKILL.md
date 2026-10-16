---
name: sprint-planning
description: Plans and sequences the real tasks produced from the user's requirement on the Kanban board — task count, names and order come from the requirement, never from a fixed template.
---
# Sprint Planning & Task Sequencing

## Mandatory Backlog-First & Sequential Execution Rule
- **Always Add to Backlog First**: Whenever the user requests any feature, enhancement, or technical task, **ALWAYS add it to the Backlog (`status: 'backlog'`) on the Authoritative Task Board immediately**.
- **Zero Interruption of Active Work**: Never interrupt, preempt, or abandon a currently active task (`assigned`, `in_progress`, `review`, or `testing`).
- **Sequential Execution**: Queue all incoming user feature requests in the `backlog` column and pull & execute them in FIFO / priority order **only after the current task reaches `done`**.
- **Clean Backlog Registration Even When Idle**: If no task is currently active, still register the new feature in `backlog` first so it is visible on the board before transitioning it into active sprint phases.

## Sequencing the Sprint (No Fixed Phases)
- **Tasks come from the requirement.** Use the `task-decomposition` skill to break the user's requirement into the tasks it actually needs. There is no fixed 4-phase cycle and no fixed task count.
- **Order by real dependencies.** Put a task after the ones it needs (`dependsOn`). Tasks that don't depend on each other can run in parallel when different agents own them.
- **Balance the team.** Assign from the real roster (`.agents/agents.json`), respecting each agent's skills, `prohibited_actions` and `delegation_targets`. Never assign to an agent that isn't in the roster.
- **Review and testing only where they add value**, and only to agents allowed to do them.

## Task Naming (Real, Specific Names)
- **Name the actual work** in plain English, e.g. `Add sprint picker to Kanban header`, `Save task order in tasks.json`, `Fix typo in Settings title`.
- **No template prefixes**: do not force `Plan:` / `Build:` / `Review:` / `Test:` onto titles.
- **No generic placeholders**: never `Task 1`, `Implementation`, `Core Feature`, `Step 2`, and never paste the user's sentence as the title.
- **Short**: under ~60 characters; put the detail in the description and acceptance criteria.

## Multi-Sprint Directory Architecture (`.agents/sprints/<sprintId>/`)
- **Master Registry**: `.agents/sprints/index.json` maintains the list of all sprints and points to the `activeSprintId`.
- **Isolated Sprint Directories**: Every sprint resides in its own isolated folder `.agents/sprints/<sprintId>/` containing:
  - `tasks.json`: Sprint-specific tasks array and metadata (`sprintId`, `version`, `updatedAt`, `tasks`).
  - `sprint-plan.md`: Sprint plan, goals, deliverables, and task decomposition table.
  - `assets/`: Deliverables, mockups, screenshots, and sprint artifacts.
- **Sprint Management Portal & APIs**:
  - `GET /api/sprints`: Returns active sprint and list of available sprints.
  - `POST /api/sprints/start`: Provisions `.agents/sprints/sprint-N/`, sets active pointer, clears active board, and broadcasts `SYNC_STATE`.
  - `POST /api/sprints/switch`: Switches active sprint in `index.json`, clears board, loads target sprint tasks from `.agents/sprints/<sprintId>/tasks.json`, and broadcasts `SYNC_STATE`.


