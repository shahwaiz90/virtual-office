---
name: team-orchestration
description: Route software requests through the orchestrator and the Kanban board.
always_on: true
---

# Team Orchestration

1. Send every software request to `tech-pm` (Scrum Master) first. It registers the request on the Kanban board and breaks it into role cards (`task-decomposition` skill).
2. Roles delegate only along their `delegation_targets` (`.agents/definitions/`), with a prompt that names the card and nothing else (`kanban-handoff` skill).
3. Each role observes its prohibited actions.
