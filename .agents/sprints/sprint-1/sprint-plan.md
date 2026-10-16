# Sprint 1 Plan: Multi-Sprint Architecture & Portal Sprint Management

## Sprint Details
- **Sprint ID**: `sprint-1`
- **Path**: `.agents/sprints/sprint-1/`
- **Status**: Active

## 4-Stage Sprint Breakdown (Authoritative Task Board)

| Task ID | Stage | Exact Task Title | Assignee | Status |
| :--- | :--- | :--- | :--- | :--- |
| **PLAN-381** | Stage 1: Scope Specs | Plan Multi-Sprint Folder Structure & Portal Sprint Switcher | `web-tech-lead` | In Progress |
| **DEV-382** | Stage 2: Core Dev | Build Sprints Directory, APIs & Kanban Sprint Controls | `web-dev` | Delegated / Queued |
| **REVIEW-383** | Stage 3: Review Diffs | Review Multi-Sprint Architecture & Switcher Diffs | `web-tech-lead` | Queued |
| **QA-384** | Stage 4: Test Suites | Test Sprints Creation, Switching & Verification | `web-tester` | Queued |

## Deliverables & Architecture
1. **Multi-Sprint Directory Isolation**: All sprint tasks (`tasks.json`), plans (`sprint-plan.md`), and assets are encapsulated in `.agents/sprints/<sprint-id>/`.
2. **Sprint Management APIs**: `GET /api/sprints`, `POST /api/sprints/start`, and `POST /api/sprints/switch`.
3. **Portal UI Controls**: Interactive active sprint badge, sprint dropdown selector, and "+ Start New Sprint" button in `KanbanBoard.tsx`.
