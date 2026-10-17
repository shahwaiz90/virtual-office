# Token use per role: before and after the lean board calls

Benchmark: `npm run bench` (`scripts/bench.js`). Each run starts a fresh scratch project, a small `wordcount` CLI with one test. It copies the checkout's role definitions and skills into it, starts that checkout's portal, and runs OpenCode 2.0.28 with `opencode/deepseek-v4.1-flash-free`. The requirement is the same every time:

> Add a --json option to the wordcount CLI (bin/wc.js) that prints the counts as a JSON object with the keys lines, words and chars. Keep the default output unchanged and cover the new option with tests.

Steps and tokens come from `opencode.db` for every session in the scratch project, grouped by agent. `build` is OpenCode's default agent, which the user talks to. The quality markers come from the board (`/api/tasks`, `/api/deliverables`), from `npm test`, and from a hidden check the agents never see: `wc --json` must print `{lines:2, words:3, chars:6}` for `a b\nc\n` (flag before or after the file), and the default line must be unchanged.

- Before: `e7799fa` (main), 4 runs.
- After: `11b0197`, 3 runs.

All runs: 2026-10-17, on the same machine, up to four at a time.

## Summary
Means over 4 before and 3 after runs (opencode/deepseek-v4.1-flash-free). Context = input + cache read + cache write tokens, summed over steps.

| Role | Steps before → after | Context tokens before → after | Change |
| :--- | :--- | :--- | :--- |
| build | 8.5 → 7.7 | 175k → 117k | -33% |
| tech-pm | 18.8 → 13.7 | 659k → 291k | -56% |
| web-tech-lead | 20.0 → 23.0 | 759k → 494k | -35% |
| web-dev | 14.8 → 11.7 | 502k → 221k | -56% |
| **Total** | **62.3 → 56.0** | **2096k → 1124k** | **-46%** |
| Output + reasoning tokens | | 46k → 25k | -46% |
| Board calls (reply bytes) | 36.3 → 25.3 | 230k → 32k | -86% |
| Minutes | 8.4 → 4.3 | | |

| Quality marker | Before | After |
| :--- | :--- | :--- |
| Requirement card done | 4/4 | 3/3 |
| Every work card done | 4/4 | 3/3 |
| Every work card has acceptance criteria | 4/4 | 3/3 |
| Every work card has a result | 4/4 | 3/3 |
| prd, architecture, source_code and code_review deliverables | 4/4 | 3/3 |
| Review verdict recorded | 4/4 | 3/3 |
| npm test passes | 4/4 | 3/3 |
| Hidden check (--json output, default unchanged) | 4/4 | 3/3 |
| Acceptance criteria per work card (mean) | 5.8 | 4.8 |

Acceptance criteria per run: before 9, 11, 16 and 10; after 10, 9 and 10. The 16 came from a run where the Scrum Master wrote a longer list; without it, the before mean is 10.0 against 9.7 after.

Always-loaded text: AGENTS.md went from 2,973 to 1,240 bytes. The role prompts grew by about 1 KB each because they now carry the board quick reference, and roles mostly stopped reading the 6.6 KB skill.

## Per run
| Role | before-1: steps / context / output | before-2: steps / context / output | before-3: steps / context / output | before-4: steps / context / output | after-9: steps / context / output | after-10: steps / context / output | after-11: steps / context / output |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| build | 11 / 276k / 5764 | 10 / 195k / 5031 | 6 / 96k / 1511 | 7 / 131k / 2668 | 8 / 123k / 1301 | 7 / 107k / 1179 | 8 / 122k / 1675 |
| tech-pm | 14 / 404k / 5266 | 15 / 615k / 9398 | 24 / 932k / 26k | 22 / 686k / 15k | 19 / 414k / 6730 | 12 / 249k / 5427 | 10 / 209k / 4674 |
| web-tech-lead | 22 / 763k / 23k | 23 / 604k / 19k | 18 / 1082k / 17k | 17 / 588k / 20k | 22 / 460k / 11k | 20 / 423k / 9436 | 27 / 601k / 21k |
| web-dev | 19 / 883k / 9300 | 17 / 485k / 8895 | 9 / 241k / 6054 | 14 / 398k / 11k | 14 / 260k / 4401 | 12 / 237k / 3681 | 9 / 167k / 3775 |
| explore | - | - | - | 1 / 3030 / 2 | - | - | - |
| **Total** | **66 / 2326k / 43k** | **65 / 1899k / 42k** | **57 / 2351k / 50k** | **61 / 1806k / 49k** | **63 / 1258k / 24k** | **51 / 1015k / 20k** | **54 / 1098k / 31k** |

| Marker | before-1 | before-2 | before-3 | before-4 | after-9 | after-10 | after-11 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Board calls (output bytes) | 39 (323k) | 41 (185k) | 23 (312k) | 42 (101k) | 27 (35k) | 26 (37k) | 23 (25k) |
| Cards (requirement column) | 4 (done) | 3 (done) | 5 (done) | 3 (done) | 3 (done) | 3 (done) | 3 (done) |
| Work cards done | all: web-tech-lead:done, web-dev:done | all: web-tech-lead:done, web-dev:done | all: web-tech-lead:done, web-dev:done | all: web-tech-lead:done, web-dev:done | all: web-tech-lead:done, web-dev:done | all: web-tech-lead:done, web-dev:done | all: web-tech-lead:done, web-dev:done |
| Acceptance criteria (cards with them) | 9 (2) | 11 (2) | 16 (2) | 10 (2) | 10 (2) | 9 (2) | 10 (2) |
| Cards with a result | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| Deliverables | code_review, source_code, architecture, prd | code_review, source_code, architecture, prd | prd, code_review, source_code, architecture | code_review, architecture, source_code, prd | architecture, code_review, source_code, prd | architecture, code_review, source_code, prd | code_review×2, source_code, architecture, prd |
| Review verdict | yes | yes | yes | yes | yes | yes | yes |
| npm test / hidden check | pass / pass | pass / pass | pass / pass | pass / pass | pass / pass | pass / pass | pass / pass |
| Minutes | 7.8 | 5.9 | 12.9 | 7 | 4.2 | 4.1 | 4.6 |

## What changed the numbers
- **Board replies.** Before, `register` and `POST /api/deliverables` returned the whole office state (about 51 KB), and `status` and `thread` returned the full card with its thread. Every reply stays in the agent's context for all later steps. Board reply bytes fell 86%.
- **One call to start, one to finish.** `start` moves the card and prints the compact card. `finish` posts the deliverable, records the result and moves the card.
- **OpenCode's subagent depth limit.** OpenCode allows one level of subagents by default. Before, every PM→Lead and Lead→Dev subagent call failed ("Subagent depth limit reached (1)"), and the roles improvised: retries, or one run launching a nested `opencode run`. Roles started as subagents now end their reply with `HANDOFF` lines, and AGENTS.md tells the top-level agent to dispatch them.
- **Leaner AGENTS.md.** It no longer points at `.agents/runtime-manifest.json`, which the default agent used to read (30 KB). It also tells the top-level agent not to explore the project before routing.

## Intermediate runs (not in the summary)
`after-1` and `after-2` ran `cdff67b`, which had the compact card and start/finish but not the short default replies or the HANDOFF dispatch. Context came out flat (2,261k and 2,161k): the models still called the old endpoints, which returned the full state. `after-3` to `after-8` ran the later commits `8f6a55b` and `de90d45`, which averaged 1,187k context (−43%). One of those runs missed the `architecture` deliverable: the Lead's quick reference showed a deliverable only at finish. `11b0197` fixes that by having delegating roles publish their contract when they hand on.

## Reproduce
```bash
git worktree add ../vo-before main   # needs node_modules (symlink or npm install)
npm run bench -- run --vo ../vo-before --label before-1 --out bench/before-1.json
npm run bench -- run --label after-1 --out bench/after-1.json
npm run bench -- summary --before bench/before-1.json --after bench/after-1.json
```
