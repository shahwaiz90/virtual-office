# Changelog

## 1.2.1

### Fixed
- **OpenCode activity now shows in the portal.** Sessions are read from OpenCode's own database (`opencode.db`), for both OpenCode 2 (`session_v2` / `session_message`) and 1.x (`session` / `message` / `part`), from the TUI or `opencode run`. Each conversation gets one card, with tool calls, commands, file edits and token usage on the activity log; subagent work is credited to its role. Needs Node 22.13+ (built-in SQLite) or the `sqlite3` command.

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
