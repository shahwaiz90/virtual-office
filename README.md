# 🏢 AI Agent Virtual Office (`agent-virtual-office`)

> **Live 2D Virtual Office Visualizer, Real-Time Kanban Board & Delivery Intelligence Analytics for Autonomous Multi-Agent Workflows (iOS, Android, Web, and Backend).**

[![npm version](https://img.shields.io/npm/v/agent-virtual-office.svg?style=flat-square)](https://www.npmjs.com/package/agent-virtual-office)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg?style=flat-square)](https://nodejs.org)

---

## 🌟 Overview

**AI Agent Virtual Office** is an interactive, browser-based visualizer for autonomous AI software engineering teams (Antigravity, Claude, OpenCode, Gemini, Cursor). It brings agent swarms to life on an animated 2D floor plan with character walking, physical task document handoffs, live Kanban board transitions, real-time activity logs, and delivery intelligence analytics with code changes.

Works **plug-and-play across any codebase**: whether you are developing an **Android app (Kotlin)**, **iOS app (Swift)**, **Web app (Next.js / React)**, or **Backend service (Python / Go)**.

---

## 🚀 How to Run

You only need **2 commands** to run the virtual office in any project:

```bash
# 1. Navigate to your project directory
cd /path/to/your/project

# 2. Launch the Virtual Office
npx agent-virtual-office
```

That's it! 

The visualizer will:
1. **Auto-detect your project** and discover your agent team (from `agents.json`, `.agents/` folder, or load a default 4-role team template).
2. **Start the local server** (default: `http://localhost:3000`).
3. **Automatically open your browser** directly to your live office.

> [!TIP]
> **Zero Installation Required:** You do **not** need to install anything globally, run `npm init`, or add `package.json` to your project. Your codebase remains 100% clean.

---

## 🎮 Key Capabilities

### 1. 🏢 Animated 2D Pixel-Art Floor Plan
- **Station Quarters**: Dedicated workstations for each configured role with computer monitors, personal storage, status badges, and desk orientation.
- **Physical Document Handoffs**: Characters walk between rooms and pass animated flying task documents when role delegations occur.
- **Executive Huddle Lounge**: Central cafe and conference space with armchairs, coffee tables, and team break activities.

### 2. 📋 Authoritative Kanban Board
- Reactive columns (**Backlog**, **Assigned**, **In Progress**, **Review**, **Testing**, **Done**).
- Dynamic role deliverables derived directly from configured agents (`ARCH`, `DEV`, `TEST`, `REV`, `REL`).
- Automatic resolution of board tasks when features are delivered or test suites pass green.

### 3. 📊 Delivery Intelligence & Analytics
- **File Changes & Updated Content**: Audit every file modified by agents with dynamic role filters, action badges (`Created`, `Modified`, `Refactored`), and an expandable dark-theme code viewer showing the exact code added.
- **Tool Usage Analytics**: Live breakdown of all autonomous tools executed (`write_to_file`, `replace_file_content`, `view_file`, `run_command`, etc.) with invocation counts and execution times.
- **Top Skills Breakdown**: Frequency and duration metrics for project skills.
- **Role Invocations & SLA Adherence**: Real-time tracking of agent dispatches, active work time, and SLA compliance.

### 4. 📜 Real-Time Activity Logs & Terminal Stream
- Searchable activity stream capturing tool executions, file edits, and handoff events.
- Filterable by specific agent or event type.

---

## ⚙️ Custom Agent Configuration (Optional)

The virtual office works out of the box with zero configuration. If you want to define custom agents, simply provide either:

### Option A: `agents.json` or `.agents/agents.json`

```json
{
  "agents": [
    {
      "id": "tech-lead",
      "name": "Technical Architect",
      "role": "Principal Mobile Architect",
      "badge": "ARCH",
      "description": "Designs component boundaries, pre-maps impacted files, and defines test specs.",
      "skills": ["architecture", "impact-analysis", "code-review"],
      "allowed_tools": ["view_file", "search_web"],
      "delegation_targets": ["developer", "tester"]
    },
    {
      "id": "developer",
      "name": "Feature Developer",
      "role": "Core Feature Engineer",
      "badge": "DEV",
      "description": "Implements domain logic, UI screens, and unit test suites.",
      "skills": ["feature-implementation", "unit-tests"],
      "allowed_tools": ["write_to_file", "replace_file_content", "run_command"],
      "delegation_targets": ["tech-lead"]
    }
  ]
}
```

### Option B: `.agents/` or `agents/` Directory
You can also organize agents into individual files inside an `.agents/` or `agents/` folder:
- **JSON**: `.agents/developer.json`
- **YAML**: `.agents/architect.yaml`
- **Markdown with frontmatter**: `.agents/tester.md`
- **Subdirectories**: `.agents/delivery-pm/agent.json`

---

## 🛠️ CLI Options

```text
Usage: npx agent-virtual-office [options]

Options:
  -p, --port <number>    Port to run dashboard on (default: 3000)
  -d, --dir <path>       Target project directory (default: current working directory)
  --no-open              Do not automatically open the browser
  -v, --version          Show version number
  -h, --help             Show help guide
```

---

## 📄 License

MIT © Syed Ahmad Shahwaiz
