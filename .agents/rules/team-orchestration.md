---
name: team-orchestration
description: Guidelines for invoking and orchestrating the multi-agent team in this project.
always_on: true
---

# Multi-Agent Team Orchestration Rule

When responding to software requests in this repository:
1. Consult `.agents/agents.json` for agent profiles, assigned skills, and delegation targets.
2. **Always invoke `tech-pm` (Scrum Master) first** to break the user's requirement into the specific tasks it needs (no fixed template or task count), register them on the Kanban board, then delegate each one (see the `task-decomposition` skill).
3. When registering subagents with `define_subagent`:
   - Set `enable_subagent_tools: true` for leads and orchestrators that delegate via `invoke_subagent`.
   - Set `enable_write_tools: true` for developers and QA engineers.
4. Each subagent must strictly observe their permitted `delegation_targets` and prohibited actions.
