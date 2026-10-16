# Claude Code Guidelines & Multi-Agent Team: Virtual Office

> [!IMPORTANT]
> ### 🎯 PRIMARY ORCHESTRATOR ROUTING: `tech-pm`
> **Always route incoming software engineering requests to `tech-pm` (Scrum Master) first.**
> Do not perform monolithic implementation directly. The primary orchestrator deconstructs requests into structured sprint tasks, delegating to specialized team agents.

---

## 👥 Active Multi-Agent Team Roster

| Agent ID | Role | Hierarchy | Allowed Tools | Delegation Targets |
| :--- | :--- | :--- | :--- | :--- |
| **`tech-pm`** | Tech Scrum Master | **👑 Primary Orchestrator** | `view_file, run_command, invoke_subagent, send_message` | `web-tech-lead` |
| **`web-tech-lead`** | Tech Lead | *Subagent Specialist* | `view_file, run_command, git_diff, invoke_subagent, send_message` | `web-dev` |
| **`web-dev`** | Developer | *Subagent Specialist* | `view_file, write_to_file, replace_file_content, run_command` | `web-tech-lead` |

---

## 🔁 How Handoffs Work (Kanban Board = Agent Channel)

Each role is a Claude Code subagent in `.claude/agents/`. Subagents cannot start other subagents, so this main session is the dispatcher:

1. Send the user's requirement to `tech-pm` with the Agent tool. It registers a requirement card, breaks it into role-specific task cards on the board, and replies with `HANDOFF <KEY> -> <agentId>` lines.
2. For each HANDOFF line (respecting `dependsOn` on the cards), start that subagent with only: `Your task: <KEY>. Read it with curl -s "http://localhost:3000/api/tasks/<KEY>?format=md" and follow the kanban-handoff skill.`
3. Repeat for HANDOFF lines those subagents return, until the requirement card is done.

Never paste instructions into a delegation prompt: everything an agent needs is on its card, and every question, decision and result goes on the card's thread, so the board shows the whole conversation.

---

## 🛠️ Essential Project Commands

- **Start Development Server:** `npm run dev`
- **Launch Virtual Office Engine:** `npm run launch` or `node server/launcher.js`
- **Validate Canonical Agent Registry:** `node bin/agents.js validate`
- **Synchronize Multi-Provider Outputs:** `node bin/agents.js sync`
- **Run Environment Diagnostics:** `node bin/agents.js doctor`
- **Audit Skills:** `node bin/agents.js skills`

---

## 🔒 Guardrails & Prohibited Actions

### `tech-pm` (Scrum Master)
- 🚫 **No direct application code modifications**

### `web-tech-lead` (Web Lead)
- 🚫 **No direct unreviewed code pushes to main**

### `web-dev` (Web Dev)
- 🚫 **No breaking architectural contracts**

---

## 🧠 Domain Skills Reference

- **`tech-pm`**: [`kanban-handoff`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/kanban-handoff/SKILL.md), [`task-decomposition`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/task-decomposition/SKILL.md), [`read-jira`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/read-jira/SKILL.md), [`read-confluence`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/read-confluence/SKILL.md), [`requirement-analysis`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/requirement-analysis/SKILL.md), [`sprint-planning`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/sprint-planning/SKILL.md), [`writing-guidelines`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/writing-guidelines/SKILL.md)
- **`web-tech-lead`**: [`kanban-handoff`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/kanban-handoff/SKILL.md), [`task-decomposition`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/task-decomposition/SKILL.md), [`react-best-practices`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/react-best-practices/SKILL.md), [`composition-patterns`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/composition-patterns/SKILL.md), [`web-design-guidelines`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/web-design-guidelines/SKILL.md), [`vercel-optimize`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/vercel-optimize/SKILL.md), [`modern-web-guidance`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/modern-web-guidance/SKILL.md)
- **`web-dev`**: [`kanban-handoff`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/kanban-handoff/SKILL.md), [`task-decomposition`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/task-decomposition/SKILL.md), [`react-best-practices`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/react-best-practices/SKILL.md), [`composition-patterns`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/composition-patterns/SKILL.md), [`react-view-transitions`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/react-view-transitions/SKILL.md), [`feature-implementation`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/feature-implementation/SKILL.md), [`modern-web-guidance`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/modern-web-guidance/SKILL.md), [`deploy-to-vercel`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/deploy-to-vercel/SKILL.md)
