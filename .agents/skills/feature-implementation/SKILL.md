---
name: feature-implementation
description: How a developer delivers a card in this codebase - read the contract, change the smallest set of files, verify every acceptance criterion, and report it on the card.
---
# Feature Implementation

The card's brief is the contract (`kanban-handoff`). If it conflicts with the code, ask on the thread before deviating.

1. **Read first**: the files in the card's `context`, their callers, and the existing helpers you can reuse. Match the surrounding naming, structure and comment density.
2. **Change the minimum**: only the files the contract needs. No drive-by refactors, no new dependencies unless the brief allows them.
3. **No invented data**: never hardcode sample tasks, demo values, fake metrics or guessed state. Show what is real, or show it as unknown.
4. **Types and errors**: keep TypeScript strict (no `any` to silence errors). Handle the empty, loading and error states the card lists; never swallow an error silently.
5. **Test what you changed**: add or update a test under `tests/` next to the code's existing tests, run `npm test`, and for UI changes run `npm run build` and check the page.
6. **Report**: the result on the card names every changed file and how each acceptance criterion is met. Post the `source_code` deliverable, then move the card to `review`.
