# Changelog

## Unreleased

### Changed
- **Fewer tokens per role** (46% fewer context tokens and 46% fewer output tokens per requirement on the benchmark, with the same quality markers; see `docs/benchmarks/token-use.md`). Every board reply stays in an agent's context for the rest of its work, so the calls agents make are now small:
  - `POST /api/tasks/<KEY>/start` moves the card to `in_progress` and prints the compact card in one call. A card with an open dependency stays put. A card in review is read by its delegator.
  - `GET /api/tasks/<KEY>?format=brief` is the compact card: brief, acceptance criteria, context, sub-tasks with results, deliverable ids and the latest 4 thread entries (`&thread=<n>` for more). `?format=md` still returns everything.
  - `POST /api/tasks/<KEY>/finish` posts the deliverable, records the result and moves the card (`review`, or `done` on a card you own) in one call.
  - `register`, `thread`, `status` and `POST /api/deliverables` reply with a short summary instead of the whole office state, the thread or the posted content. Pass `?format=full` for the old reply.
  - JSON sent with a plain `curl -d` (no Content-Type header) is accepted.
- AGENTS.md (injected into every OpenCode agent, subagents included) holds only routing and the dispatch steps; the Mermaid diagram, roster table and skill list are gone. It no longer points at `.agents/runtime-manifest.json`. The `define_subagent` note moved to `.agents/rules/team-orchestration.md`.
- Each role prompt has a board quick reference with its own calls ready to run. It reads the `kanban-handoff` skill only for edge cases, and the card's `skill` before it starts.
- OpenCode allows one level of subagents by default. Roles started as subagents now end their reply with `HANDOFF <KEY> -> <agentId>` lines instead of failing to start a subagent, and AGENTS.md tells the top-level agent to dispatch them.

### Added
- Optional `model: provider/model` in a role's definition is written to `.opencode/agent/<id>.md`. Off by default.
- `npm run bench`: runs a fixed requirement through OpenCode in a scratch project and reports per-role steps and tokens with quality markers (see `docs/benchmarks/`).

## 1.2.1

### Fixed
- **OpenCode activity now shows in the portal.** Sessions are read from OpenCode's own database (`opencode.db`), for both OpenCode 2 (`session_v2` / `session_message`) and 1.x (`session` / `message` / `part`), from the TUI or `opencode run`. Each conversation gets one card, with tool calls, commands, file edits and token usage on the activity log; subagent work is credited to its role. Needs Node 22.13+ (built-in SQLite) or the `sqlite3` command.
- **Roles show as active while OpenCode works.** From the prompt until the turn ends (waiting for the model, thinking, between tool steps) the role is working on the floor plan and its time is logged.
- Time already worked was dropped when a role switched to another task; it is now kept.
- Every role is generated as an OpenCode agent (`.opencode/agent/<id>.md`), so OpenCode runs the real roles and their work is credited to them.

### Removed
- The bundled OpenCode plugin. Nothing installed it, and OpenCode 2 rejects plugins in its format (and gives plugins no tool events).
- Tailing `opencode.log`, which only contains OpenCode's internal `git` calls.

## 1.2.0

### Security
- The server listens on `127.0.0.1` only (override with `VIRTUAL_OFFICE_HOST`). API and WebSocket requests from other websites, and DNS-rebinding Host headers, are refused with 403.

### Added
- **Integrations panel:** enter the Jira / Confluence server URL and personal access token in the portal, see where each setting comes from, and test the connection. Tokens are saved to `.env.local` (mode 600, gitignored) and never sent to the browser.
- Projects whose roles use `read-jira` / `read-confluence` get `scripts/read_jira.py`, `scripts/read_confluence.py` and `.env.example` copied in when missing.
- `.agents/portal-url` tells agents which port this project's portal runs on; skills and generated agent files read it instead of assuming `localhost:3000`.
- Deliverables persist per sprint in `.agents/sprints/<sprint>/deliverables.json`.
- GitHub Actions workflow: type check, build and tests on Node 22.

### Changed
- Tailwind is compiled at build time instead of loaded from the CDN at runtime, so the portal works offline.
- Smaller package: React, Pixi and other UI libraries are build-time dependencies only (the built `dist/` ships), and avatars are resized to 512×512.
- Sprints start on demand and each conversation gets one card.
- Jira and Confluence server URLs are settings (`JIRA_BASE_URL`, `CONFLUENCE_BASE_URL`); nothing is hardcoded to a company server.
- The preferences modal no longer has voice settings.

### Removed
- Demo mode and all mock data, including fake analytics and token usage.
