---
name: codebase-explorer
description: Finds the files a change touches and what they affect (callers, types, tests, docs) in a few targeted searches, and writes it up as an impact map any role can put on a card.
---
# Codebase Explorer

Use it before you size, plan, build or review a change. Search narrowly and read only the parts you need; don't open whole large files or walk the tree.

## Find the impact in five passes
1. **Entry points.** Search for the names the request uses (UI text, route, command, component, setting): `grep -rn "Export" src server --include=*.ts* --include=*.js`. Skip `node_modules`, `dist` and `.agents/sprints`.
2. **Definitions.** For each hit, find where the function, component, type or route is defined: `grep -rn "function exportCsv\|exportCsv =" src server`.
3. **Callers and importers.** Everything that uses what will change: `grep -rln "exportCsv\|from './csv'" src server bin`. A changed signature, prop, event payload or API shape breaks these.
4. **Contracts.** Shared types (`src/types/`), API routes (`server/index.js`), event payloads (`server/eventBus.js`), stored data (`.agents/*.json`, `tasks.json`), generated files (`bin/agents.js sync` outputs). Changing one of these is never a small change.
5. **Tests and docs.** Tests that import or assert on the code, including tests that check source text: `grep -rln "exportCsv\|VirtualOffice.tsx" tests`. Docs that describe it: README, CHANGELOG, `docs/`.

Use `git log --oneline -5 -- <file>` when you need to know why code is the way it is.

## Impact map
Write the result in this shape, on the card's `context` and in your deliverable. Paths are repo-relative; one line each.

```
Change    src/components/KanbanBoard.tsx        add Export button to the header
Change    server/index.js                       new GET /api/tasks/export.csv
Affected  src/types/office.ts                   Task type is read, not changed
Affected  tests/test_card_deliverables.js       asserts on the header markup
Unchanged server/taskBoard.js                   checked: no CSV code here
Risk      large boards: stream rows, don't build one string
```

- **Change**: files to edit. **Affected**: files that depend on them and must still work (verify them). **Unchanged**: files someone might expect to touch, checked and left alone. **Risk**: what could break.
- On a card, put the paths in `context.files` (Change and Affected) and the rest in `context.decisions`.

## Size it
- **Small**: 1–3 Change files, no change to a shared type, API, event payload or stored data, no new dependency.
- **Full**: anything else, or when you are unsure.
