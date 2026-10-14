# 🏢 AI Agent Virtual Office (`agent-virtual-office`)

> **Live 2D Virtual Office Visualizer, Real-Time Kanban & Delivery Intelligence Analytics for Autonomous Multi-Agent Workflows (iOS, Android, Web, and Backend).**

[![npm version](https://img.shields.io/npm/v/agent-virtual-office.svg?style=flat-square)](https://www.npmjs.com/package/agent-virtual-office)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg?style=flat-square)](https://nodejs.org)

---

## 🌟 Overview

**AI Agent Virtual Office** is an interactive, browser-based command center for autonomous AI software engineering teams (Antigravity, Claude, OpenCode, Gemini, Cursor). It brings agent swarms to life on an animated 2D floor plan with character walking, physical task document handoffs, live Kanban movements, real-time activity logs, and executive delivery intelligence analytics.

Works **plug-and-play across any codebase**: whether you are developing an **iOS app (Swift)**, **Android app (Kotlin)**, **Web app (Next.js / React)**, or **Backend service (Python / Go)**, simply point the virtual office to your project directory. It automatically discovers your agent configurations, parses skill instructions from markdown, and begins broadcasting in real-time.

---

## 🚀 Quick Start (Zero Install)

Run directly in any project repository using `npx`:

```bash
# 1. Open Terminal inside ANY project directory (iOS, Android, Web, Python):
cd /path/to/my-project

# 2. Run:
npx agent-virtual-office
```

Or run from anywhere targeting an external project path or specific config:

```bash
npx agent-virtual-office --dir /path/to/my-ios-app
npx agent-virtual-office --dir /path/to/my-android-app --port 3030
npx agent-virtual-office --config /path/to/opencode/agents.json
npx agent-virtual-office --dir /path/to/monorepo # Automatically merges all agents.json files!
```

> [!IMPORTANT]
> **Zero Setup & No `npm init` Required!**
> You do **NOT** need to run `npm init`, create a `package.json`, or install `node_modules` inside your native iOS, Android, or Python repositories.
> `npx` runs externally from an isolated cache and inspects your codebase from the outside. Your project remains **100% pure and clean**.

The launcher will:
1. Start the Express & WebSocket visualizer backend on your designated port (default: `3000`).
2. Auto-discover all configured agents and skills across `.agents/agents.json`, `opencode/agents.json`, or recursively scan all subfolders. In monorepos with multiple configs, it intelligently merges all agents into one unified team.
3. Automatically launch your browser (Google Chrome / default) directly to `http://localhost:3000`.

---

## 📦 Global or Local Installation

### Global CLI (Recommended for Daily Use)

Install globally once, and run it anywhere on your machine:

```bash
npm install -g agent-virtual-office

# Now run from inside ANY project folder:
cd /path/to/my-ios-app
agent-office

# Or specify a target directory:
agent-virtual-office --dir /path/to/my-project
```

### In Your Web / Node.js Repository (`package.json`)

```bash
npm install --save-dev agent-virtual-office
```

Add a convenience script to your `package.json`:

```json
{
  "scripts": {
    "agent-office": "agent-virtual-office"
  }
}
```

Run with:
```bash
npm run agent-office
```

---

## 🎮 Key Capabilities

### 1. 🏢 Animated 2D Pixel-Art Floor Plan
- **Station Quarters**: Dedicated workstations for each configured role with computer monitors, personal storage, status badges, and desk facing orientation.
- **Physical Document Handoffs**: Characters walk between rooms and pass animated flying task documents when role transitions happen.
- **Executive Huddle Lounge**: Central cafe and conference space with armchairs, coffee tables, and team break activities.
- **Audio Feedback**: Interactive sound synthesis for task transitions, document handoffs, and sprint completions.

### 2. 📋 Real-Time Kanban Board
- 4-column reactive board (**To Do**, **In Progress**, **Review / Verification**, **Done**).
- Real-time milestone cards that move automatically as files are authored in `scratch/task/<KEY>/`.
- 10-Minute SLA timers tracking sprint elapsed time and SLA compliance.

### 3. ⏱️ Persistent Team Work Timers
- Every team member suite box continuously displays their active task execution time plus cumulative logged work duration.
- Visual status indicators (**Available**, **Working**, **Reviewing**, **Verifying**).

### 4. 📊 Delivery Intelligence & Analytics
- **Tool Usage Analytics**: Interactive breakdown of all tools executed (`write_to_file`, `replace_file_content`, `view_file`, `run_command`, etc.) with invocation counts, total runtime, percentage share, and role filtering.
- **Top Skills Breakdown**: Frequency and utilization metrics for project skills (`00-architecture`, `08-unit-tests`, `10-code-review`, etc.) with role-specific filters.
- **Role Activity Distribution**: Visual metrics on agent participation and delegation cycles.

### 5. 📜 Real-Time Opencode Activity Logs
- Clean, searchable activity stream capturing tool executions, file edits, and handoff events.
- Filterable by specific agent or event type with instant export capabilities.

---

## 📁 Multi-Platform Integration Guide

The virtual office works seamlessly with any language or framework without modifying your project structure:

### 1. iOS Projects (Swift / SwiftUI / Xcode)
Your iOS repository remains a pure Xcode project—no `package.json` needed.
```bash
cd ~/Projects/MyiOSApp
npx agent-virtual-office
```
*(Optional)* Add `.agents/agents.json` to define your iOS Tech Lead, Swift Developer, and QA agents.

### 2. Android Projects (Kotlin / Jetpack Compose / Gradle)
Your Android repository remains a pure Gradle project—no `package.json` needed.
```bash
cd ~/Projects/MyAndroidApp
npx agent-virtual-office
```

### 3. Web & Full-Stack Projects (Next.js, React, Node.js)
```bash
cd ~/Projects/MyWebApp
npx agent-virtual-office
```

### 4. Python, Go, Rust & Backend Microservices
```bash
cd ~/Projects/MyBackendService
npx agent-virtual-office
```

---

## ❓ Frequently Asked Questions (FAQ)

### Q: Do I need to run `npm init` or have a `package.json` in my project?
**No.** `agent-virtual-office` is a standalone CLI tool. When you run `npx agent-virtual-office`, it executes from a global cache and inspects your project directory from the outside. Your project files remain untouched.

### Q: Does it leave any temporary files or `node_modules` in my repo?
**No.** It runs in-memory and serves the dashboard via its own isolated Express/WebSocket server. It never creates `node_modules` or modifies your existing source code.

### Q: What if my project doesn't have an `agents.json` file?
**It works out of the box.** If no `.agents/agents.json` file is found, the virtual office automatically loads a standard 4-role team template (**Project Manager**, **Technical Lead**, **Developer**, **Tester / QA**) so you can start visualizing immediately without any setup.

---

## ⚙️ Custom Configuration Schema (`.agents/agents.json`)

To customize your agents, place an `agents.json` file inside your project root or in `.agents/agents.json`:

```json
{
  "agents": [
    {
      "id": "project-manager",
      "name": "Project Manager",
      "role": "Delivery Lead & Sprint Orchestrator",
      "badge": "PM",
      "description": "Intakes user requirements, scopes PRD, tracks sprint SLA, and signs off on deliverables.",
      "skills": [
        "requirement-analysis",
        "sprint-planning",
        "pm-reporting"
      ],
      "allowed_tools": [
        "view_file",
        "invoke_subagent",
        "send_message",
        "read_url_content"
      ],
      "prohibited_actions": [
        "No direct application code modifications",
        "No repository-wide search commands"
      ],
      "delegation_targets": [
        "tech-lead",
        "user"
      ]
    },
    {
      "id": "tech-lead",
      "name": "Technical Lead",
      "role": "System Architect & Code Reviewer",
      "badge": "LEAD",
      "description": "Designs 5-tier architecture, pre-maps impacted files, and performs 10-point code reviews.",
      "skills": [
        "architecture",
        "impact-analysis",
        "code-review"
      ],
      "allowed_tools": [
        "view_file",
        "git_diff",
        "invoke_subagent",
        "send_message"
      ],
      "prohibited_actions": [
        "No direct production code authoring (planning and review only)"
      ],
      "delegation_targets": [
        "developer",
        "tester"
      ]
    },
    {
      "id": "developer",
      "name": "Feature Developer",
      "role": "Core Feature Engineer",
      "badge": "DEV",
      "description": "Sole code author: implements business logic, UI screens, and unit test suites.",
      "skills": [
        "feature-implementation",
        "unit-tests",
        "refactoring"
      ],
      "allowed_tools": [
        "write_to_file",
        "replace_file_content",
        "view_file",
        "run_command"
      ],
      "prohibited_actions": [
        "No altering architectural boundaries without lead approval"
      ],
      "delegation_targets": [
        "tech-lead"
      ]
    },
    {
      "id": "tester",
      "name": "QA & Test Engineer",
      "role": "Quality Assurance & Test Automation",
      "badge": "QA",
      "description": "Executes unit and integration test suites, validates regressions, and signs off verification.",
      "skills": [
        "test-automation",
        "regression-testing"
      ],
      "allowed_tools": [
        "run_command",
        "git_diff"
      ],
      "prohibited_actions": [
        "No modifying production code"
      ],
      "delegation_targets": [
        "developer",
        "project-manager"
      ]
    }
  ]
}
```

---

## 📖 Documenting Skills (`SKILL.md`)

Each skill in an agent's `skills` array is automatically loaded from `.agents/skills/<skill-name>/SKILL.md`.

Example: `.agents/skills/architecture/SKILL.md`:

```markdown
---
name: architecture
description: Master 5-tier architecture & data boundaries (Screen -> ViewModel -> Provider -> Repository -> Service)
---

# Architecture Planning Guidelines

Defines architectural boundaries, dependency injection wiring, and data contracts.
```

The virtual office dynamically extracts the `name`, `description`, and summary from the file to populate the interactive skill dialogs and analytics in the UI.

---

## 📡 Real-Time Event Ingestion

You can broadcast events to the virtual office via REST or WebSocket:

### REST API (`POST /api/events`)

```bash
curl -X POST http://localhost:3000/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "developer",
    "type": "file_modified",
    "payload": {
      "tool": "write_to_file",
      "file": "src/features/PaymentView.swift",
      "details": "Created PaymentView with Apple Pay tokenization"
    }
  }'
```

### Supported Event Types

| Event Type | Description | Animated Behavior |
| :--- | :--- | :--- |
| `agent_active` | Agent assumes active persona | Character highlights and updates status |
| `agent_handoff` | Delegation from one role to another | Character walks to target station with flying document |
| `tool_executing` | Agent begins using a tool | Tool badge displays with live execution timer |
| `file_modified` | Code authored or edited | File activity stream updates with file badge |
| `command_executing` | Terminal command run | Activity log entries and terminal stats record |
| `test_result` | Test execution completed | Triggers celebration confetti on 100% pass |
| `task_completed` | Milestone delivered | Card moves to Done on Kanban board |

---

## 🛠️ CLI Flags & Options

```text
Options:
  -d, --dir <path>       Target project directory (iOS, Android, Web, Backend)
                         (default: current working directory)
  -p, --port <number>    Port to run the dashboard on (default: 3000)
  --no-open              Do not automatically open the browser
  --build                Rebuild web frontend before starting
  -v, --version          Show version number
  -h, --help             Show help guide
```

### Environment Variables

| Variable | Description |
| :--- | :--- |
| `PROJECT_DIR` | Target project root directory to inspect |
| `PORT` | HTTP & WebSocket server port (default: `3000`) |
| `TRANSCRIPT_PATH` | Explicit path to an Antigravity/agent `transcript.jsonl` log |

---

## 🏗️ Architecture & Tech Stack

- **Frontend**: React 19, TypeScript, Pixi.js (2D WebGL/Canvas rendering), Lucide Icons, Canvas Confetti.
- **Backend**: Node.js, Express 5, WebSocket (`ws`), Chokidar (real-time filesystem watching).
- **Bundler**: Vite 8.
- **Styling**: Modern dark-mode palette, glassmorphism, responsive floor plan layout.

---

## 📄 License

MIT © Syed Ahmad Shahwaiz
