---
name: task-decomposition
description: Breaks the user's actual requirement into the tasks it needs (no fixed template or count) and assigns each to the right role on the roster. Board calls are in the kanban-handoff skill.
---
# Task Decomposition

Use for every requirement (feature, change, bug, idea). Think about that specific request; nothing about the breakdown is fixed in advance. Register and delegate the cards with the `kanban-handoff` skill.

## Rules
1. **No template.** Never default to Plan/Build/Review/Test or to a fixed count. A typo fix is 1 task; a large feature may be 8+.
2. **Specific titles** under ~60 characters naming the work ("Add sprint picker to Kanban header"). No "Task 1", "Implementation", "Core Feature", and never the user's sentence pasted.
3. **Tasks are runtime data.** Never write task lists, keyword→title maps, stage templates or fallback tasks into `server/`, `src/` or tests.
4. **Assign from the real roster** (`.agents/agents.json`): by role, skills and `prohibited_actions`, along `delegation_targets` only. Never assign to an agent that doesn't exist; if no role fits, use the closest permitted one and say so in the description.
5. **Review/test tasks only when they add value** and a roster agent may do them.
6. **Backlog first.** New requirements go to `backlog`. Don't interrupt cards in `assigned`, `in_progress`, `review` or `testing`; pull the next backlog item (FIFO) when active work is `done`.

## Size first: small or full
Before splitting, size the request with a quick look: a few searches at most (`codebase-explorer` pass 1, entry points), not a full impact map. Post the size and the reason on the requirement thread (`kind: "decision"`), e.g. "Small: one constant in src/components/handoffChoreo.ts and its test".
- **Small** (1–3 files to change, no change to a shared type, API, event payload or stored data, no new dependency): the Scrum Master registers **one** card straight to the Developer, with `reviewer` set to the Tech Lead's id from the roster (for example `web-tech-lead`, `ios-tech-lead` or `android-tech-lead`). Its brief carries the scope (what to change and where you expect it), the acceptance criteria and how to verify; the Developer maps the impact. No contract card and no separate QA card; the Tech Lead only reviews. If the Developer is not in your `delegation_targets`, send the card to the Tech Lead marked small instead; it forwards it to the Developer without writing a contract.
- **Full** (anything else, or unsure): the usual flow, Scrum Master → Tech Lead → Developer. The Tech Lead maps the impact and puts it in the contract.
On a small card the Developer maps the impact first (`codebase-explorer`) and posts it on the thread. A Developer who finds it bigger than small says so there and hands the card back instead of growing it.

## Steps
1. Use the request's requirement card (`EPIC-<n>`) as the parent of every task (`TASK-<n>`, kanban-handoff §2).
2. Restate the requirement in one sentence and list what "done" means for the user.
3. Size the request with a quick look (above). The full impact map is the Tech Lead's (in the contract) or, on a small card, the Developer's.
4. Split into independent, verifiable tasks, each small enough for one specialist; record order in `dependsOn`.
5. Assign each task, and write each `brief` for the role receiving it: the Tech Lead gets product intent and constraints, the Developer gets the technical contract.
6. Register all cards, then delegate each by card key. Follow progress on the board, not in replies. The requirement closes itself when every sub-task is `done`; post a summary on its thread.

## Technical contract (Tech Lead → Developer)
Keep it to about 40 lines. Name what to do and how to check it; don't write the code.
1. **Goal**: one sentence.
2. **Impact map**, which the Tech Lead finds with `codebase-explorer` (the Scrum Master only sized the request): Change, Affected, Unchanged and Risk lines. Put the Change and Affected paths in the card's `context.files` too.
3. **Interfaces**: new or changed signatures, props, API shapes, payloads. Only the ones that change.
4. **Edge cases**: the few that matter.
5. **Verify**: how each acceptance criterion is checked (test name, command, what to look at).
The same contract, impact map included, is your `architecture` deliverable.

## Example breakdowns (illustrations, not a template)
- "Fix the typo in the Settings modal title" → small: `TASK-1 Fix typo in Settings modal title` → the Developer, reviewer the Tech Lead.
- "Make handoff walks faster" → small: `TASK-5 Shorten handoff walk timings` → the Developer, reviewer the Tech Lead (one constants block and one test).
- "Export the board as CSV" (requirement `EPIC-4`) → `TASK-10 Define CSV columns` (web-tech-lead), `TASK-11 Add GET /api/tasks/export.csv` (web-dev, dependsOn TASK-10), `TASK-12 Add Export button to Kanban header` (web-dev, dependsOn TASK-11).
