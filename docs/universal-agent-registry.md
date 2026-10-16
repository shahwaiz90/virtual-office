# Universal AI Agent Registry — User & Developer Guide
**Task ID:** `REG-105` (Comprehensive Multi-Framework Documentation)  
**Version:** `2.0.0`  
**Author:** Android Tech Lead (`android-tech-lead`)  
**Applicability:** OpenCode, Claude Code, OpenAI Codex, Gemini CLI  

---

## 1. Overview & Single Source of Truth (SSOT)

The **Universal AI Agent Registry** provides a unified, vendor-neutral Single Source of Truth for defining and orchestrating multi-agent software teams. Instead of maintaining disparate, fragmented configuration files (`CLAUDE.md`, `GEMINI.md`, `AGENTS.md`, `runtime-manifest.json`, `agents.json`) that inevitably diverge and introduce schema drift, teams define their agents and skills once canonically. The synchronization engine then automatically compiles and updates all provider-specific runtime configurations.

```mermaid
flowchart TD
    subgraph Canonical_SSOT [Single Source of Truth (SSOT)]
        REG[".agents/registry.yaml"]
        DEFS[".agents/definitions/<agent-id>.md"]
        SKILLS[".agents/skills/<skill-id>/SKILL.md"]
    end

    CLI["CLI Command: agents (sync, validate, list, skills, doctor, clean)"]
    REG --> CLI
    DEFS --> CLI
    SKILLS --> CLI

    subgraph Providers [Multi-Provider Generation]
        CLI -->|OpenCode Adapter| OP["AGENTS.md<br/>.agents/runtime-manifest.json<br/>.agents/rules/team-orchestration.md<br/>.agents/agents.json"]
        CLI -->|Claude Code Adapter| CL["CLAUDE.md<br/>.claude/config.json"]
        CLI -->|OpenAI Codex Adapter| CX[".codex/instructions.md<br/>.codex/system-prompts.md"]
        CLI -->|Gemini CLI Adapter| GM["GEMINI.md"]
    end
```

---

## 2. Canonical Directory Structure

```
.agents/
├── registry.yaml                     # Central registry manifest & provider configurations
├── definitions/                      # Canonical agent definitions (Markdown + YAML Frontmatter)
│   ├── android-pm.md                 # Primary Orchestrator definition & persona prompt
│   ├── android-tech-lead.md          # Tech Lead & Architect definition & prompt
│   ├── android-dev.md                # Core Developer definition & prompt
│   └── android-tester.md             # QA Specialist definition & prompt
├── skills/                           # Canonical domain skills & playbooks
│   ├── task-decomposition/
│   │   └── SKILL.md
│   ├── android-architecture/
│   │   └── SKILL.md
│   └── ...
├── backup/                           # Automatic timestamped backups prior to migrations
└── rules/                            # Generated workspace orchestration rules
```

---

## 3. Canonical Schema Reference

### 3.1 Registry Manifest (`.agents/registry.yaml`)

```yaml
version: "2.0.0"
name: "Virtual Office Multi-Agent Team"
description: "Universal multi-agent team registry for Virtual Office"
orchestrator: "android-pm"
default_framework: "all"
skills_dir: "skills"

agents:
  - id: "android-pm"
    path: "definitions/android-pm.md"
    primary: true
  - id: "android-tech-lead"
    path: "definitions/android-tech-lead.md"
  - id: "android-dev"
    path: "definitions/android-dev.md"
  - id: "android-tester"
    path: "definitions/android-tester.md"

adapters:
  opencode:
    enabled: true
    sync_agents_json: true
    sync_runtime_manifest: true
    sync_team_rule: true
  claude:
    enabled: true
    target_file: "CLAUDE.md"
    sync_config: true
  codex:
    enabled: true
    target_file: "AGENTS.md"
  gemini:
    enabled: true
    target_file: "GEMINI.md"
```

### 3.2 Agent Definition (`.agents/definitions/<agent-id>.md`)

Every agent is defined in Markdown with a YAML frontmatter block:

```markdown
---
id: "android-dev"
name: "Android Core Developer"
role: "Feature & Compose Engineer"
badge: "DEV"
avatar_url: "/assets/developer.png"
is_primary: false
allowed_tools:
  - "view_file"
  - "write_to_file"
  - "replace_file_content"
  - "run_command"
enable_subagent_tools: false
enable_write_tools: true
enable_mcp_tools: false
prohibited_actions:
  - "No altering architectural boundaries without lead approval"
delegation_targets:
  - "android-tech-lead"
skills:
  - "task-decomposition"
  - "android-cli"
  - "android-architecture"
  - "gradle-build"
  - "edge-to-edge"
  - "adaptive"
---

# Identity & Role: Android Core Developer (`android-dev`) - SUBAGENT
You are **Android Core Developer** (`android-dev`), serving as **Feature & Compose Engineer**, a specialized subagent operating under the Primary Orchestrator **Android Product Lead** (`android-pm`).

## Role Description & Responsibilities
Executes implementation tasks assigned by Tech Lead/PM on the Authoritative Task Board. Breaks down complex features into sub-components and transitions tasks from In Progress to Review upon code completion.

## Tool Capabilities & Permissions
You are authorized to use the following tools:
- `view_file`
- `write_to_file`
- `replace_file_content`
- `run_command`
...
```

---

## 4. Multi-Provider Framework Support

| Framework | Target Files | Key Capabilities |
| :--- | :--- | :--- |
| **OpenCode & Antigravity** | `AGENTS.md`, `.agents/runtime-manifest.json`, `.agents/rules/team-orchestration.md`, `.agents/agents.json` | Visual Mermaid graph, active roster table, dynamic `define_subagent` payloads, 100% backward compatibility for visualizer. |
| **Claude Code** | `CLAUDE.md`, `.claude/config.json` | Orchestration directives, primary routing rules, essential commands, tool safety constraints. |
| **OpenAI Codex** | `.codex/instructions.md`, `.codex/system-prompts.md`, `AGENTS.md` | Role prompt sections, strict prohibited actions, tool manifests. |
| **Gemini CLI** | `GEMINI.md` | Context guidelines, primary orchestrator routing, subagent invocation schemas, skill mapping. |

---

## 5. CLI Command Reference (`agents`)

The CLI is available directly as `agents` or via `node bin/agents.js`.

### 5.1 `agents sync`
Synchronizes the canonical registry into provider-specific artifacts.
```bash
# Sync all enabled provider frameworks
agents sync

# Sync only for Claude Code
agents sync --framework=claude

# Preview files that would be modified without writing
agents sync --dry-run

# Run in background watch mode (auto-sync on file edits)
agents sync --watch
```

### 5.2 `agents validate`
Validates schema syntax, ID constraints, orchestrator presence, skill references, and checks for delegation deadlocks.
```bash
# Run schema and constraint verification
agents validate

# Strict mode (fails on warnings)
agents validate --strict

# Output machine-readable JSON
agents validate --json
```

### 5.3 `agents list`
Lists all registered agents in the team roster.
```bash
# Formatted console table
agents list

# Machine-readable JSON output
agents list --json
```

### 5.4 `agents skills`
Audits assigned skills and checks that documentation exists on disk.
```bash
# List all skills and referenced agents
agents skills

# Show only skills missing on disk
agents skills --missing

# Filter by skill ID
agents skills --filter=task-decomposition
```

### 5.5 `agents doctor`
Runs comprehensive diagnostic health checks on workspace permissions, canonical registry integrity, skills documentation, and provider synchronization status.
```bash
agents doctor
```

### 5.6 `agents clean`
Removes generated provider files without touching canonical Single Source of Truth files.
```bash
# Dry run clean preview
agents clean --dry-run

# Clean specific framework
agents clean --framework=codex
```

### 5.7 `agents migrate`
Safely migrates legacy `.agents/agents.json` into `.agents/definitions/*.md` and `.agents/registry.yaml`.
```bash
agents migrate
```

---

## 6. Migration Guide (Legacy to Canonical SSOT)

For projects using older `.agents/agents.json`:
1. Run the migration command:
   ```bash
   node bin/agents.js migrate
   ```
2. The migration engine creates an automatic backup in `.agents/backup/migration-<timestamp>/`.
3. Agent definitions are extracted to `.agents/definitions/<agent-id>.md` with preserved prompts, avatars, tools, and skills.
4. `.agents/registry.yaml` is generated.
5. Legacy `.agents/agents.json` remains synchronized on every `agents sync` run, ensuring zero breaking changes for existing scripts, visualizers, or UI tools.

---

## 7. Extending the Team

### 7.1 Adding a New Agent
1. Create `.agents/definitions/<new-agent-id>.md` with frontmatter:
   ```markdown
   ---
   id: security-lead
   name: Security Architect
   role: InfoSec & Vulnerability Auditor
   badge: SEC
   avatar_url: /assets/security.png
   allowed_tools:
     - view_file
     - run_command
   skills:
     - security-audit
   ---
   # Security Architect System Prompt
   ...
   ```
2. Add the agent to `.agents/registry.yaml` under `agents`.
3. Run `agents validate` to verify schema integrity.
4. Run `agents sync` to compile into all provider outputs.

### 7.2 Adding a New Skill
1. Create a directory `.agents/skills/<skill-id>/`.
2. Add `SKILL.md` documenting triggers, workflows, and standards.
3. Reference `<skill-id>` in the relevant agent's `skills` array.
4. Run `agents sync`.
