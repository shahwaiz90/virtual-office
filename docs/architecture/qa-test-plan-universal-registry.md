# QA & Verification Test Plan — Universal AI Agent Registry
**Task ID:** `REG-104` (Automated Testing & Multi-Framework Verification)  
**Author:** Android Tech Lead (`android-tech-lead`)  
**Assignee:** `android-tester` (QA Specialist)  
**Status:** Ready for Execution

---

## 1. Overview & Verification Objectives

The Universal AI Agent Registry transforms the configuration model of Virtual Office from a legacy single JSON file (`.agents/agents.json`) into an extensible Single Source of Truth (`.agents/registry.yaml`, `.agents/definitions/*.md`, `.agents/skills/*`).

The verification suite must validate:
1. **Canonical Schema & Parsing**:
   - YAML frontmatter parser handles scalars, arrays, booleans, nested lists, and multi-line markdown prompts.
   - Serialization preserves comments, structure, and attributes.
   - Canonical loader correctly indexes agents and discovers skills on disk.
2. **Validator & Doctor Engine**:
   - Catches missing orchestrator IDs.
   - Detects dangling delegation targets.
   - Validates skill paths and flags missing skills.
   - Validates allowed tools and flags unknown or dangerous configurations.
   - `doctor` reports clear diagnostics and actionable suggestions.
3. **Multi-Provider Adapters Verification**:
   - **OpenCode**: Generates valid `AGENTS.md` (Mermaid diagrams, team table, agent profiles), `.agents/rules/team-orchestration.md`, `.agents/runtime-manifest.json`, and backward-compatible `agents.json`.
   - **Claude Code**: Generates `CLAUDE.md` and `.claude/config.json` with correct project commands, role routing, and tool permissions.
   - **OpenAI Codex**: Generates Codex instructions and tool definitions.
   - **Gemini CLI**: Generates `GEMINI.md` with persona prompts and schema definitions.
4. **CLI Commands (`agents`)**:
   - `agents validate` (exits 0 on clean, non-zero on invalid)
   - `agents sync` (supports `--dry-run`, `--framework=<name>`)
   - `agents list` (supports `--json`)
   - `agents skills` (lists all skills, verifies on-disk status)
   - `agents doctor` (checks project health)
   - `agents clean` (removes provider artifacts cleanly without affecting SSOT files)
5. **Regression Verification**:
   - Existing server discovery (`server/agentDiscovery.js`) and runtime registry (`server/agentRuntimeRegistry.js`) continue to function without regressions.
   - Legacy test suites in `tests/` pass.

---

## 2. Test Cases Matrix

| Test Suite ID | Test Case | Target Component | Expected Behavior |
| :--- | :--- | :--- | :--- |
| `TC-REG-01` | Frontmatter Parse & Serialize | `server/registry/frontmatterParser.js` | Parses YAML headers, preserves markdown body, round-trips accurately. |
| `TC-REG-02` | Canonical Registry Loading | `server/registry/canonicalRegistry.js` | Loads `.agents/definitions/*.md` and links `.agents/skills/`. |
| `TC-REG-03` | Validation Rules & Edge Cases | `server/registry/validator.js` | Flags missing files, invalid IDs, circular delegation deadlocks. |
| `TC-REG-04` | OpenCode Adapter Sync | `server/adapters/opencodeAdapter.js` | Generates compliant `AGENTS.md` & runtime manifest. |
| `TC-REG-05` | Claude Code Adapter Sync | `server/adapters/claudeAdapter.js` | Generates compliant `CLAUDE.md` & `.claude/config.json`. |
| `TC-REG-06` | Gemini CLI Adapter Sync | `server/adapters/geminiAdapter.js` | Generates compliant `GEMINI.md`. |
| `TC-REG-07` | OpenAI Codex Adapter Sync | `server/adapters/codexAdapter.js` | Generates compliant Codex directives. |
| `TC-REG-08` | CLI Subcommands End-to-End | `bin/agents.js` | All subcommands execute successfully with appropriate exit codes. |
| `TC-REG-09` | Clean & Restore | `server/adapters/index.js` | `clean` removes generated targets safely; `sync` restores them. |
| `TC-REG-10` | Backward Compatibility | `server/agentRuntimeRegistry.js` | Server loads seamlessly and visualizer events stay intact. |
