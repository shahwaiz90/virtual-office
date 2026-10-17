# 🏢 AI Agent Virtual Office (`agent-virtual-office`)

> **Talk to one routine. The team finishes the work.**  
> You describe what you want to the Scrum Master. It sizes the request, picks the platform team (Web, Android or iOS), and puts it on a Kanban board as cards; that team's Tech Lead, Developer and QA pick those cards up and finish them, and you watch it happen in an animated 2D office.

[![npm version](https://img.shields.io/npm/v/agent-virtual-office.svg?style=flat-square)](https://www.npmjs.com/package/agent-virtual-office)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg?style=flat-square)](https://nodejs.org)

---

## 💡 What is Virtual Office? (In Simple Terms)

One conversation in, finished work out. You talk to a single routine, the **Scrum Master** (`tech-pm`). It takes a quick look, decides whether the request is small or full and which platform team owns it (Web, Android or iOS; Web when unclear), and registers it on the board: a small change goes straight to that team's Developer (`<platform>-dev`) with its Tech Lead (`<platform>-tech-lead`) as reviewer; a bigger one goes to the Tech Lead, who writes technical contracts for the Developer and hands testing to QA. Every instruction, decision and result lives on the cards, so each agent reads its card instead of a pasted prompt, and you see the work move from **Backlog ➔ In Progress ➔ Review ➔ Done**.

**Virtual Office makes that teamwork visible:** each agent (the Scrum Master, plus a Tech Lead, Developer and QA for each platform team) has its own role, permissions and skills, and you can follow every handoff live. The office shows the team you saved in the **Agent Virtual Office Setup** modal, with a desk for each of its agents.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                              AI AGENT VIRTUAL OFFICE                           │
│                                                                                │
│  Scrum Master (tech-pm)                                                        │
│    └── Sizes the request, picks the platform team, writes the cards            │
│         │                                                                      │
│         ├──► Web team                                                          │
│         │     Web Lead (web-tech-lead) ──► Web Dev (web-dev)                   │
│         │                              └─► Web QA (web-tester)                 │
│         │                                                                      │
│         ├──► Android team                                                      │
│         │     Android Lead (android-tech-lead) ──► Android Dev (android-dev)   │
│         │                                      └─► Android QA (android-tester) │
│         │                                                                      │
│         └──► iOS team                                                          │
│               iOS Lead (ios-tech-lead) ──► iOS Dev (ios-dev)                   │
│                                        └─► iOS QA (ios-tester)                 │
│                                                                                │
│  Each Lead writes contracts and reviews; Dev builds; QA tests.                 │
└────────────────────────────────────────────────────────────────────────────────┘
```

Whatever custom LLM model or AI platform you use (**Claude**, **OpenAI / Codex**, **Gemini / Antigravity**, **Cursor**, **OpenCode**), Virtual Office watches your agents in real time and visually illustrates:
1. **Interactive Virtual Office**: Agents walk across the floor, sit at their desks, and physically hand off tasks to one another.
2. **Live Kanban Board**: Raw AI prompts and subagent handoffs are translated into real-time sprint cards (**Backlog ➔ In Progress ➔ Review ➔ Done**) with creation timestamps.
3. **Inter-Agent Communications**: See exactly what agents are discussing, why a task was delegated, and the prompt instructions exchanged.
4. **Skills & Tools Intelligence**: Real-time analytics showing the most used skills, tool calls (file edits, terminal commands, web search), and code changes.

---

## 🔁 Agentic workflow

You talk to one routine. The **main session** (your Claude Code chat) only dispatches: it sends your request to the Scrum Master, then starts each subagent named in the `HANDOFF <KEY> -> <agentId>` lines it gets back, until the requirement card is done. It never edits project files. Each role below is a Claude Code subagent in `.claude/agents/`, generated from `.agents/definitions/<id>.md` by `node bin/agents.js sync`. The roster has ten agents: the Scrum Master and three platform teams (Web, Android, iOS), each with a Tech Lead, a Developer and QA. Web is the default team. Fast path: a small change goes to `<platform>-dev` with reviewer `<platform>-tech-lead`; a full change goes to `<platform>-tech-lead`. The office shows only the team saved in the Agent Virtual Office Setup modal; this table lists every definition in the repository.

| Role | What it is | Skills | Tools | Hands work to | Reports to | Routine (every card) | Context it reads | Delivers | Never | Token in | Token out |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Main session (dispatcher) | Your Claude Code chat, not a subagent | Follows `CLAUDE.md` | The session's own tools | `tech-pm`, then whoever a HANDOFF line names | You | Sends the request to `tech-pm`; starts each HANDOFF subagent with only the card key | `CLAUDE.md` and HANDOFF lines | Nothing on the board | Editing project files or writing code | not recorded separately² | not recorded separately² |
| [Scrum Master](.agents/definitions/tech-pm.md) (`tech-pm`) | Subagent, orchestrator | kanban-handoff, task-decomposition, codebase-explorer, requirement-analysis, sprint-planning, read-jira, read-confluence, writing-guidelines | view_file, run_command, invoke_subagent, send_message (Claude Code: Read, Grep, Glob, Bash) | `web-tech-lead`, `web-dev`, `android-tech-lead`, `android-dev`, `ios-tech-lead`, `ios-dev` | You | Sizes the request (small or full) and picks the platform team (web when unclear); registers the requirement and task cards; emits HANDOFF lines; posts a summary when the cards are done | The requirement card (your request) | `prd` | Modifying application code | ~0.9M–1.3M (n=2)¹ | ~0.5k–4.4k (n=2)¹ |
| [Web Lead](.agents/definitions/web-tech-lead.md) (`web-tech-lead`) | Subagent, Web team (default) | kanban-handoff, task-decomposition, codebase-explorer, react-best-practices, composition-patterns, web-design-guidelines, vercel-optimize, modern-web-guidance | view_file, run_command, git_diff, invoke_subagent, send_message (Claude Code: Read, Grep, Glob, Bash) | `web-dev`, `web-tester` | `tech-pm` | Writes short technical contracts with the impact map as Developer cards; hands QA a card when needed; reviews Developer and QA cards | Its card: brief, criteria, context files, decisions, thread | `architecture` (plan) or `code_review` | Pushing unreviewed code to main | typical ~200k–600k³ | typical ~3k–10k³ |
| [Web Dev](.agents/definitions/web-dev.md) (`web-dev`) | Subagent, Web team (default) | kanban-handoff, feature-implementation, codebase-explorer, react-best-practices, composition-patterns, react-view-transitions, modern-web-guidance, deploy-to-vercel | view_file, write_to_file, replace_file_content, run_command (Claude Code: Read, Grep, Glob, Bash, Write, Edit) | — | `web-tech-lead` | Maps the impact on a fast-path card; builds the change; checks each criterion; records the result and moves the card to review | Its card: contract or brief, criteria, context files, decisions, thread | `source_code` (code + PR) | Breaking architectural contracts | typical ~200k–1M³ | typical ~2k–10k³ |
| [Web QA](.agents/definitions/web-tester.md) (`web-tester`) | Subagent, Web team (default) | kanban-handoff, codebase-explorer, automated-testing, web-design-guidelines, modern-web-guidance | run_command, view_file, git_diff (Claude Code: Read, Grep, Glob, Bash) | — | `web-tech-lead` | Runs Vitest/Playwright and an accessibility/UX check; records pass/fail per criterion; moves the card to done or back with defects | Its card: what to test, criteria, impact map, the Developer's result | `test_report` | Modifying production code | typical ~100k–400k³ | typical ~1k–5k³ |
| [Android Lead](.agents/definitions/android-tech-lead.md) (`android-tech-lead`) | Subagent, Android team | kanban-handoff, task-decomposition, codebase-explorer, android-architecture, android-cli, r8-analyzer, agp-9-upgrade, android-permissions-security, android-intent-security | view_file, run_command, git_diff, invoke_subagent, send_message (Claude Code: Read, Grep, Glob, Bash) | `android-dev`, `android-tester` | `tech-pm` | Writes short technical contracts with the impact map as Developer cards; hands QA a card when needed; reviews Developer and QA cards | Its card: brief, criteria, context files, decisions, thread | `architecture` (plan) or `code_review` | Pushing unreviewed code to main | not measured yet³ | not measured yet³ |
| [Android Dev](.agents/definitions/android-dev.md) (`android-dev`) | Subagent, Android team | kanban-handoff, feature-implementation, codebase-explorer, android-cli, android-architecture, gradle-build, jetpack-compose-performance, edge-to-edge, adaptive, navigation-3, migrate-xml-views-to-jetpack-compose | view_file, write_to_file, replace_file_content, run_command (Claude Code: Read, Grep, Glob, Bash, Write, Edit) | — | `android-tech-lead` | Maps the impact on a fast-path card; builds the change; checks each criterion; records the result and moves the card to review | Its card: contract or brief, criteria, context files, decisions, thread | `source_code` (code + PR) | Breaking architectural contracts | not measured yet³ | not measured yet³ |
| [Android QA](.agents/definitions/android-tester.md) (`android-tester`) | Subagent, Android team | kanban-handoff, codebase-explorer, android-testing, testing-setup, android-profiler, android-cli, gradle-build | run_command, view_file, git_diff (Claude Code: Read, Grep, Glob, Bash) | — | `android-tech-lead` | Runs JUnit, Compose UI and instrumented tests through Gradle, plus a profiling and accessibility check; records pass/fail per criterion; moves the card to done or back with defects | Its card: what to test, criteria, impact map, the Developer's result | `test_report` | Modifying production code | not measured yet³ | not measured yet³ |
| [iOS Lead](.agents/definitions/ios-tech-lead.md) (`ios-tech-lead`) | Subagent, iOS team | kanban-handoff, task-decomposition, codebase-explorer, swiftui-specialist, uikit-app-modernization, audit-xcode-security-settings, xcode-project-setup, c-bounds-safety | view_file, run_command, git_diff, invoke_subagent, send_message (Claude Code: Read, Grep, Glob, Bash) | `ios-dev`, `ios-tester` | `tech-pm` | Writes short technical contracts with the impact map as Developer cards; hands QA a card when needed; reviews Developer and QA cards | Its card: brief, criteria, context files, decisions, thread | `architecture` (plan) or `code_review` | Pushing unreviewed code to main | not measured yet³ | not measured yet³ |
| [iOS Dev](.agents/definitions/ios-dev.md) (`ios-dev`) | Subagent, iOS team | kanban-handoff, feature-implementation, codebase-explorer, swiftui-specialist, swiftui-whats-new-27, uikit-app-modernization, xcode-project-setup, device-interaction | view_file, write_to_file, replace_file_content, run_command (Claude Code: Read, Grep, Glob, Bash, Write, Edit) | — | `ios-tech-lead` | Maps the impact on a fast-path card; builds the change; checks each criterion; records the result and moves the card to review | Its card: contract or brief, criteria, context files, decisions, thread | `source_code` (code + PR) | Breaking architectural contracts | not measured yet³ | not measured yet³ |
| [iOS QA](.agents/definitions/ios-tester.md) (`ios-tester`) | Subagent, iOS team | kanban-handoff, codebase-explorer, test-modernizer, device-interaction, xcode-project-setup, audit-xcode-security-settings | run_command, view_file, git_diff (Claude Code: Read, Grep, Glob, Bash) | — | `ios-tech-lead` | Runs XCTest, Swift Testing and XCUITest suites on simulators or devices, plus an accessibility check; records pass/fail per criterion; moves the card to done or back with defects | Its card: what to test, criteria, impact map, the Developer's result | `test_report` | Modifying production code | not measured yet³ | not measured yet³ |

No agent gets a pasted prompt: instructions, decisions and results all live on the card, and every agent starts by reading it.

¹ Measured from the portal's recorded card usage (`tokenUsage` on each card, the same data behind `tokenUsageAnalytics` in `GET /api/state`) on 2026-10-17. Token in = input + cache read + cache write tokens; token out = output tokens. Range over the done cards that have recorded usage. Only two done cards had usage, both Scrum Master requirement cards opened from chat, so the figures also include the dispatching turns on that conversation.  
² The main session's usage is counted on the requirement card it opened, not on its own row.  
³ Typical: no done card for this role had recorded usage yet, so this is an estimate, not a measurement. "Not measured yet" means no estimate has been made either; expect figures close to the matching web role. Run `npm run bench` (below) to measure it for your own model.

---

## 🏛️ The 4 Core Pillars

### 1. 👥 Specialized Agent & Subagent Orchestration
- **Hierarchy & Clear Roles**: Staff dedicated agents such as **Scrum Master (`tech-pm`)**, a **Tech Lead**, **Developer** and **QA Engineer** for each platform team (Web, Android, iOS).
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
1. **Auto-detect your codebase**: Discovers existing agents from `.agents/` or `agents.json`. In a project with no team yet, the portal opens **Agent Virtual Office Setup**, where you pick a platform team (Android, iOS, Web, …) or build your own in Team Studio.
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

Agents can send JSON with a plain `curl -d` (no Content-Type header). The older `/status`, `/thread`, `/register` and `POST /api/deliverables` calls still work and reply with a short summary; `?format=full` returns the old reply with the whole card and office state.

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
│   │   ├── web-*.md           # Web team: web-tech-lead, web-dev, web-tester
│   │   ├── android-*.md       # Android team: android-tech-lead, -dev, -tester
│   │   └── ios-*.md           # iOS team: ios-tech-lead, ios-dev, ios-tester
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
