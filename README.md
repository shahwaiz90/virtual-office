# 🏢 AI Agent Virtual Office (`agent-virtual-office`)

> **The Live Visual Command Center for Autonomous Multi-Agent Software Teams.**  
> Turn complex multi-agent workflows into an animated 2D virtual office, live Kanban sprint board, inter-agent communication stream, and real-time delivery intelligence dashboard.

[![npm version](https://img.shields.io/npm/v/agent-virtual-office.svg?style=flat-square)](https://www.npmjs.com/package/agent-virtual-office)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg?style=flat-square)](https://nodejs.org)

---

## 💡 What is Virtual Office? (In Simple Terms)

If you have ever used an AI coding assistant, you know how hard it is to track what is happening behind the scenes when multiple AI agents work together. 

**Virtual Office turns invisible AI teamwork into a visible, physical office:**

Instead of a single AI chatbot answering inside a text box, you staff an **entire software engineering team of AI agents and specialized subagents** (e.g. Scrum Master, Tech Lead, Senior Developer, QA Tester). Each agent has their own desk, role, clear permissions, and assigned skills.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        AI AGENT VIRTUAL OFFICE                         │
│                                                                        │
│   👑 Scrum Master (Tech PM)                                            │
│      └── Decomposes user goal into a 4-stage sprint                    │
│                                                                        │
│   🧩 Technical Lead (Architect)                                        │
│      ├── Plans technical contracts & reviews code                      │
│      │                                                                 │
│      ├──► 💻 Core Developer (Android / iOS / Web / Backend)            │
│      │    └── Implements features using official domain skills         │
│      │                                                                 │
│      └──► 🧪 Mobile QA / Tester                                        │
│           └── Runs test suites & validates acceptance criteria         │
└────────────────────────────────────────────────────────────────────────┘
```

Whatever custom LLM model or AI platform you use (**Claude**, **OpenAI / Codex**, **Gemini / Antigravity**, **Cursor**, **OpenCode**), Virtual Office watches your agents in real time and visually illustrates:
1. **Interactive Virtual Office**: Agents walk across the floor, sit at their desks, and physically hand off tasks to one another.
2. **Live Kanban Board**: Raw AI prompts and subagent handoffs are translated into real-time sprint cards (**Backlog ➔ In Progress ➔ Review ➔ Done**) with creation timestamps.
3. **Inter-Agent Communications**: See exactly what agents are discussing, why a task was delegated, and the prompt instructions exchanged.
4. **Skills & Tools Intelligence**: Real-time analytics showing the most used skills, tool calls (file edits, terminal commands, web search), and code changes.

---

## 🏛️ The 4 Core Pillars

### 1. 👥 Specialized Agent & Subagent Orchestration
- **Hierarchy & Clear Roles**: Staff dedicated agents such as **Scrum Master (`tech-pm`)**, **Architect (`tech-lead`)**, **Developers**, and **QA Engineers**.
- **Top-Level Orchestration**: The Primary Orchestrator receives stakeholder goals and breaks them down into sequenced sprint tasks.
- **Subagent Delegation with Guardrails**: Agents only communicate along permitted delegation channels with enforced input/output contracts, permissions, and prohibited actions (e.g. preventing Scrum Masters or Testers from writing unauthorized production code).

### 2. 🧰 Official Platform Skills & Custom Extensibility
Agents are only as good as the domain knowledge they possess. Virtual Office equips agents with curated, official platform skills and makes it easy to add your own:

- **📱 Android & Mobile**: Jetpack Compose Performance, Clean Architecture, CameraX, LiteRT on-device AI, Navigation 3, Edge-to-Edge, Glance Home Widgets, AGP 9 migration.
- **🍎 iOS & Apple**: Modern SwiftUI patterns, Bounds Safety, Xcode Project Setup, Automated Testing.
- **🌐 Web & Fullstack**: React / Next.js composition patterns, Modern Web Standards, Vercel performance optimization.
- **🔬 Tools, APIs & Automation**: Automated Jira & Confluence readers, SQLite project isolation, testing harnesses, and database exploration.
- **✨ Custom Skills**: Simply drop a markdown file into `.agents/skills/your-skill/SKILL.md` to instantly teach your agent team custom company procedures, APIs, or design systems.

### 3. 🧠 Universal & LLM Agnostic
Virtual Office doesn't lock you into any single AI provider or model. It supports:
- **Anthropic Claude** (via `CLAUDE.md` and `.claude/config.json`)
- **OpenAI / Codex** (via `.codex/instructions.md` and `AGENTS.md`)
- **Google DeepMind Gemini / Antigravity** (via `GEMINI.md` and runtime rules)
- **OpenCode & Local Models** (via `.agents/registry.yaml` and `.agents/definitions/*.md`)

With the built-in CLI (`npx agents sync`), any change made to your team roster or skills is automatically compiled across all provider files with zero drift.

### 4. 📊 Real-Time Visual Transparency & Analytics
Non-technical managers and engineers can see the whole picture at a glance:
- **Floor Plan Live View**: Animated characters walk to workstations, type on monitors, or gather in the conference lounge.
- **Authoritative Kanban Board**: Watch tasks move from *Backlog* to *In Progress* to *Review* and *Done*, with exact timestamps and assignee avatars.
- **Agent Chat & Handoff Stream**: Real-time log of agent dialogues, tool executions, and file edits.
- **Code Change Inspector**: Dark-theme file diff viewer showing exactly what code was added or modified by each agent.
- **Spoken handoffs (optional)**: The browser can announce handoffs between agents aloud.

---

## 🚀 Quick Start (Zero Setup)

You only need **2 commands** to run Virtual Office in any existing or new project:

```bash
# 1. Navigate to your project folder
cd /path/to/your/project

# 2. Launch the Virtual Office
npx agent-virtual-office
```

That's it! The visualizer will:
1. **Auto-detect your codebase**: Discovers existing agents from `.agents/` or `agents.json`. In a project with no team yet, the portal opens **Agent Command Center Setup**, where you pick a platform team (Android, iOS, Web, …) or build your own in Team Studio.
2. **Scaffold agent definitions**: Automatically initializes `.agents/definitions/` so every agent has documented skills, tools, and rules.
3. **Launch the Dashboard**: Starts the local server (default: `http://localhost:3000`, or the next free port) and opens it in your browser (Safari on macOS).

> [!NOTE]
> **Local only.** The server listens on `127.0.0.1` and refuses requests from other websites (Origin and Host checks), so a page you visit cannot read your board or use your tokens. To reach it from another machine on purpose, set `VIRTUAL_OFFICE_HOST=0.0.0.0`.
>
> Agents find the running portal through `.agents/portal-url` (written at startup and gitignored), so several projects can run on different ports at once.

### Where the activity comes from

Nothing to install in your agent tool: the portal reads each tool's own session history for this project folder.

| Tool | Read from |
| :--- | :--- |
| Claude Code | `~/.claude/projects/<project>/*.jsonl` (including subagents and worktrees) |
| OpenCode (TUI or `opencode run`, 1.x and 2.x) | `~/.local/share/opencode/opencode.db`. Needs Node 22.13+ or the `sqlite3` command |
| Antigravity / Gemini | `~/.gemini/antigravity/brain/*` |

Board updates themselves (cards, handoffs, deliverables) come from the agents calling the board API, as described in the `kanban-handoff` skill.

The calls agents make are kept small, because every response stays in the agent's context for the rest of its work:

| Call | What it does |
| :--- | :--- |
| `POST /api/tasks/<KEY>/start` | Moves the card to `in_progress` (unless a dependency is open) and prints the compact card |
| `GET /api/tasks/<KEY>?format=brief` | Compact card: brief, acceptance criteria, context, sub-tasks, deliverable ids and the latest thread entries (`&thread=<n>` for more) |
| `POST /api/tasks/<KEY>/finish` | Deliverable, result and move (`review`, or `done` on a card you own) in one call |
| `GET /api/tasks/<KEY>?format=md` | The whole card with its full thread, for people and edge cases |

Agents can send JSON with a plain `curl -d` (no Content-Type header). The older `/status`, `/thread` and `/api/deliverables` calls still work; add `?format=brief` for a short reply.

> [!TIP]
> **Zero Global Installation Required:** You do **not** need to install anything globally, run `npm init`, or pollute your codebase with extra configuration files.

---

## 🔑 Jira & Confluence Access (Optional)

The `read-jira` and `read-confluence` skills fetch tickets and pages with `scripts/read_jira.py` and `scripts/read_confluence.py`. Each needs your server URL and a personal access token:

| Variable | Example | Used by |
| :--- | :--- | :--- |
| `JIRA_BASE_URL` | `https://jira.your-company.com` | `read-jira` |
| `JIRA_PATH` | personal access token (Jira > your avatar > Profile > Personal Access Tokens) | `read-jira` |
| `CONFLUENCE_BASE_URL` | `https://confluence.your-company.com` | `read-confluence` |
| `CONFLUENCE_PATH` | personal access token (Confluence > your avatar > Settings > Personal Access Tokens) | `read-confluence` |

Set them in **one** of these ways:

1. **In the portal (easiest):** open **Integrations** (key icon in the header), paste the server URL and token, and press **Save**. They are written to `.env.local` in your project (mode 600, gitignored).
2. **Project file:** `cp .env.example .env.local` in the project root and replace the placeholders. `.env.local` is gitignored.
3. **Shell:** `export JIRA_BASE_URL="https://jira.your-company.com"` and `export JIRA_PATH="<token>"` (add them to `~/.zshrc` to keep them).
4. **One run only:** `python3 scripts/read_jira.py https://jira.your-company.com/browse/PROJ-123 --token <token>` (`--pat` for Confluence).

**Integrations** also shows what is set and where it came from, and has **Test connection**. Roles that use these skills get the two scripts copied into the project's `scripts/` folder (existing files are never overwritten). Without a setting the scripts stop with these instructions, and the header shows what is missing while a role on your team uses the skill. Tokens are only sent to the server you configure, and the portal never displays them.

---

## 📁 How the Agent Team is Organized

Your agent team is stored directly inside your repository in standard, human-readable markdown and YAML:

```text
your-project/
├── .agents/
│   ├── registry.yaml          # Universal Single Source of Truth for your team
│   ├── definitions/           # 1 Markdown file per agent profile
│   │   ├── tech-pm.md         # Scrum Master / Primary Orchestrator
│   │   ├── tech-lead.md       # Technical Architect
│   │   ├── developer.md       # Core Developer
│   │   └── tester.md          # QA Engineer
│   ├── skills/                # Domain skills (Android, iOS, Web, Custom)
│   │   ├── task-decomposition/
│   │   ├── android-architecture/
│   │   └── your-custom-skill/
│   └── rules/                 # Auto-enforced orchestration guidelines
├── AGENTS.md                  # Discovery anchor for Codex / Antigravity
├── CLAUDE.md                  # Formatted instructions for Claude
└── GEMINI.md                  # Formatted instructions for Gemini CLI
```

---

## 🛠️ CLI Commands & Multi-Project Switching

### Run the Dashboard
```bash
# Start on a custom port
npx agent-virtual-office --port 3001

# Watch a specific project path without changing current terminal directory
npx agent-virtual-office --dir /path/to/other/project
```

### Universal Agent Registry CLI (`agents`)
Manage your agent team, validate schemas, or sync provider files via the included CLI:

```bash
# Compile and sync definitions across AGENTS.md, CLAUDE.md, and GEMINI.md
npx agents sync

# Validate schema integrity, skills on disk, and detect circular delegation loops
npx agents validate

# Audit assigned skills and check for missing documentation
npx agents skills

# Run a complete health check on your project's agent configuration
npx agents doctor
```

To pin the model OpenCode runs a role with, add `model: provider/model` (for example `model: opencode/deepseek-v4.1-flash-free`) to that role's `.agents/definitions/<id>.md` and run `npx agents sync`. Without it, roles use OpenCode's default model.

#### Measuring token use per role
`npm run bench -- run --label after --out bench/after.json` runs a fixed requirement in a scratch project with OpenCode (default model `opencode/deepseek-v4.1-flash-free`) and records each role's steps and tokens from `opencode.db`, plus the quality markers: cards, acceptance criteria, deliverables, review verdict, `npm test` and a check the agents never see. `--vo <checkout>` benchmarks another checkout of Virtual Office; `npm run bench -- compare a.json b.json` prints the tables side by side.

---

## 🤝 Sharing with Your Team: Frequently Asked Questions

<details>
<summary><b>Q: Do my teammates need to install anything special to view the office?</b></summary>
<p>No. Anyone with Node.js installed can simply run <code>npx agent-virtual-office</code> in the project directory. The web visualizer opens automatically in their browser without any login or cloud accounts.</p>
</details>

<details>
<summary><b>Q: Can we customize the agents, names, and avatars?</b></summary>
<p>Yes. You can edit agents directly through the interactive <b>Team Studio</b> in the web interface, or edit the clean markdown files in <code>.agents/definitions/</code>. You can set custom roles, names, badges, allowed tools, and upload avatars.</p>
</details>

<details>
<summary><b>Q: What prevents agents from making breaking code changes?</b></summary>
<p>The 6-category specification enforces strict governance: prohibited actions (e.g. <i>"No modifying production code without tech lead review"</i>), allowed tool whitelists, and defined delegation targets prevent rogue behavior.</p>
</details>

<details>
<summary><b>Q: Does this work with private / proprietary codebases?</b></summary>
<p>Yes, 100%. Virtual Office runs locally on your machine. No code, logs, or project files are sent to external servers or cloud dashboards.</p>
</details>

---

## 📄 License

MIT © Syed Ahmad Shahwaiz
