# Universal AI Agent Registry — Single Source of Truth Architecture Specification
**Task ID:** `REG-101` (Architecture Spike & Implementation Contracts)  
**Author:** Android Tech Lead (`android-tech-lead`)  
**Target Audience:** `android-pm` (Delivery Lead), `android-dev` (Core Developer), `android-tester` (QA Specialist)  
**Status:** Approved Architectural Contract

---

## 1. Executive Summary & Problem Statement

Currently, the Virtual Office project uses an initial `.agents/agents.json` and auto-generated `AGENTS.md` / `.agents/runtime-manifest.json` designed primarily around single-file JSON definitions. While functional, modern AI agent environments across the engineering ecosystem utilize divergent conventions:
- **Claude Code**: Uses `CLAUDE.md` and `.claude/` project-level configurations.
- **Gemini CLI**: Uses `GEMINI.md` and context instruction standards.
- **OpenAI Codex**: Uses `AGENTS.md` system guidelines and tool manifests.
- **OpenCode & Antigravity**: Uses `AGENTS.md`, `.agents/runtime-manifest.json`, and dynamic subagent runtime registrations.

Managing separate configuration files across these tools leads to schema drift, stale prompts, disjoint tool permissions, and synchronization bugs.

### Solution: Universal AI Agent Registry
A **Single Source of Truth (SSOT)** design where:
1. Each agent is declared canonically in `.agents/definitions/<agent-id>.md` (YAML frontmatter + rich Markdown prompt).
2. The team registry and workspace metadata reside in `.agents/registry.yaml` (with `.agents/registry.json` fallback).
3. Specialized domain skills reside in `.agents/skills/<skill-id>/SKILL.md`.
4. Extensible **Provider Adapters** compile the single source of truth into exact runtime artifacts for **OpenCode**, **Claude Code**, **OpenAI Codex**, and **Gemini CLI**.
5. A unified CLI command `agents` (with subcommands `sync`, `validate`, `list`, `skills`, `doctor`, `clean`) manages the lifecycle, verification, and file watching.

```mermaid
flowchart TD
    subgraph Canonical_SSOT [Single Source of Truth (SSOT)]
        REG[".agents/registry.yaml (or registry.json)"]
        DEFS[".agents/definitions/<agent-id>.md"]
        SKILLS[".agents/skills/<skill-id>/SKILL.md"]
    end

    ENGINE["Universal Registry Engine & CLI (agents)"]
    REG --> ENGINE
    DEFS --> ENGINE
    SKILLS --> ENGINE

    subgraph Adapters [Multi-Provider Adapters]
        AD_OPENCODE["OpenCode / Antigravity Adapter"]
        AD_CLAUDE["Claude Code Adapter"]
        AD_CODEX["OpenAI Codex Adapter"]
        AD_GEMINI["Gemini CLI Adapter"]
    end

    ENGINE --> AD_OPENCODE
    ENGINE --> AD_CLAUDE
    ENGINE --> AD_CODEX
    ENGINE --> AD_GEMINI

    subgraph Targets [Generated Targets]
        AD_OPENCODE --> AG_MD["AGENTS.md + runtime-manifest.json + agents.json"]
        AD_CLAUDE --> CL_MD["CLAUDE.md + .claude/config.json"]
        AD_CODEX --> CX_MD["AGENTS.md / Codex Prompts"]
        AD_GEMINI --> GM_MD["GEMINI.md"]
    end
```

---

## 2. Canonical Data Models & File Formats

### 2.1 Registry Manifest (`.agents/registry.yaml` / `.agents/registry.json`)
The registry manifest acts as the central orchestrator manifest.

```yaml
version: "2.0.0"
name: "Virtual Office Multi-Agent Team"
description: "Universal multi-agent team registry for Virtual Office"
orchestrator: "android-pm"
default_framework: "all"
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
skills_dir: "skills"
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

### 2.2 Agent Definition Specification (`.agents/definitions/<agent-id>.md`)
Each agent is represented as a markdown document with a YAML frontmatter header containing strict metadata and markdown body containing its instructions / system prompt.

```markdown
---
id: "android-tech-lead"
name: "Android Tech Lead"
role: "System Architect & Code Reviewer"
badge: "LEAD"
avatar_url: "/assets/techlead.png"
is_primary: false
allowed_tools:
  - "view_file"
  - "run_command"
  - "git_diff"
  - "invoke_subagent"
  - "send_message"
enable_subagent_tools: true
enable_write_tools: true
enable_mcp_tools: false
prohibited_actions:
  - "No direct implementation commits without review"
delegation_targets:
  - "android-dev"
  - "android-tester"
skills:
  - "task-decomposition"
  - "android-architecture"
  - "android-cli"
  - "r8-analyzer"
  - "agp-9-upgrade"
  - "android-permissions-security"
  - "android-intent-security"
  - "glance-canonical-layouts"
---

# Identity & Role: Android Tech Lead (`android-tech-lead`) - SUBAGENT
You are **Android Tech Lead** (`android-tech-lead`), serving as **System Architect & Code Reviewer**, a specialized subagent operating under the Primary Orchestrator **Android Product Lead** (`android-pm`).

## Role Description & Responsibilities
Deconstructs technical architecture into implementation contracts, spike tasks, and code reviews. Assigns development work items to the Core Developer and verification suites to QA, tracking progress on the Authoritative Task Board.
...
```

### 2.3 Skill Specification (`.agents/skills/<skill-id>/SKILL.md`)
Each skill is contained in its own folder under `.agents/skills/<skill-id>/` with `SKILL.md` defining:
- Skill Name & Description
- Usage Triggers & Workflows
- Concrete Code Examples & Anti-patterns
- Optional `references/`, `rules/`, or `metadata.json`

---

## 3. Provider Adapters Specification

All adapters implement a unified interface:

```typescript
interface ProviderAdapter {
  name: 'opencode' | 'claude' | 'codex' | 'gemini';
  description: string;
  targetFiles: string[];
  generate(registry: CanonicalRegistry, projectRoot: string): Promise<AdapterOutput>;
  validate(projectRoot: string, registry: CanonicalRegistry): Promise<ValidationResult>;
  clean(projectRoot: string): Promise<CleanResult>;
}
```

### 3.1 OpenCode / Antigravity Adapter
- **Outputs:**
  - `AGENTS.md`: Full orchestration manual with Mermaid workflow diagram, active team roster table, detailed agent profiles with skills hyperlinks, and subagent registration guidance.
  - `.agents/rules/team-orchestration.md`: Workspace always-on rule instructing agents on delegation protocol.
  - `.agents/runtime-manifest.json`: Pre-compiled agent payloads for `define_subagent` and dynamic runtime loading.
  - `.agents/agents.json`: Maintained in sync for backward compatibility with older Virtual Office tools.

### 3.2 Claude Code Adapter
- **Outputs:**
  - `CLAUDE.md`: Formatted for Claude Code guidelines:
    - Primary Orchestrator Routing directive (`Always route tasks to primary agent first`).
    - Active Team Roster and capabilities summary.
    - Essential commands (`npm run dev`, `npm test`, `agents validate`, `agents sync`).
    - Tool permissions, code style, and security guidelines.
    - Subagent invocation patterns and prompt routing.
  - `.claude/config.json`: Project settings registering tools and agent preferences.

### 3.3 OpenAI Codex Adapter
- **Outputs:**
  - `AGENTS.md` (or Codex instruction blocks): Formatted with system instructions, role permissions, strict guardrails (`prohibited_actions`), and tool mappings.

### 3.4 Gemini CLI Adapter
- **Outputs:**
  - `GEMINI.md`: Formatted for Gemini CLI context ingestion:
    - Team role definitions and hierarchy.
    - Context guidelines, strict prohibited actions.
    - Subagent invocation schemas (`invoke_subagent`).
    - Domain skills mapping.

---

## 4. CLI Architecture (`agents`)

The CLI is implemented under `bin/agents.js` and exported to `package.json` (`"agents": "bin/agents.js"`), also runnable via `node bin/agents.js` or `./bin/cli.js agents`.

### 4.1 Subcommands & Options

| Command | Arguments / Flags | Description |
| :--- | :--- | :--- |
| `agents sync` | `[--framework=<all\|opencode\|claude\|codex\|gemini>]` `[--dry-run]` `[--watch]` `[--dir=<path>]` | Compiles canonical definitions into provider files. |
| `agents validate` | `[--dir=<path>]` `[--strict]` | Validates schema integrity, skill paths, delegation targets, and circular deadlocks. |
| `agents list` | `[--json]` `[--dir=<path>]` | Displays a table or JSON of registered agents, roles, tools, and delegation targets. |
| `agents skills` | `[--filter=<id>]` `[--missing]` `[--dir=<path>]` | Audits registered skills, shows usage per agent, and flags missing or dangling skills. |
| `agents doctor` | `[--dir=<path>]` | Runs deep diagnostic health checks across environment, files, permissions, and sync state. |
| `agents clean` | `[--framework=<name>]` `[--dry-run]` `[--dir=<path>]` | Safely removes generated provider files without touching canonical files. |

---

## 5. Migration Strategy (`REG-103`)

The migration engine will:
1. Detect legacy `.agents/agents.json`.
2. Extract each agent into `.agents/definitions/<agent-id>.md` with frontmatter and body.
3. Generate `.agents/registry.yaml` referencing all extracted agents and skills.
4. Keep `.agents/agents.json` synchronized via the OpenCode adapter to maintain 100% backward compatibility for all existing visualizer code and watchers.
5. Create backups of modified files (`.agents/backup/`).

---

## 6. Implementation Task Delegations

- **`REG-101` [Tech Lead]**: Architecture Specification (Current Document), Schema Definitions, and Coordination.
- **`REG-102` [Core Developer - `android-dev`]**:
  - Implement Canonical Registry Parser (`server/registry/canonicalRegistry.js`).
  - Implement Provider Adapters (`server/adapters/opencodeAdapter.js`, `claudeAdapter.js`, `codexAdapter.js`, `geminiAdapter.js`, `index.js`).
  - Implement CLI tool (`bin/agents.js` & `server/registry/cli.js`).
  - Implement Watcher & Sync Engine (`server/registry/watcher.js`).
  - Implement Migration Script (`server/registry/migration.js`).
- **`REG-103` [Tech Lead + `android-dev`]**: Execute migration of current agents (`android-pm`, `android-tech-lead`, `android-dev`, `android-tester`) into `.agents/definitions/*.md` and `.agents/registry.yaml`.
- **`REG-104` [QA Specialist - `android-tester`]**:
  - Write test suite (`tests/test_universal_agent_registry.js`):
    - Unit tests: Frontmatter parser, registry loader, validation engine.
    - Adapter tests: OpenCode, Claude Code (`CLAUDE.md`), OpenAI Codex, Gemini CLI (`GEMINI.md`).
    - CLI tests: `agents sync`, `agents validate`, `agents list`, `agents skills`, `agents doctor`, `agents clean`.
    - Regression tests: Existing watchers and visualizer compatibility with synced `agents.json`.
- **`REG-105` [Tech Lead]**: Comprehensive Documentation (`docs/universal-agent-registry.md`).
