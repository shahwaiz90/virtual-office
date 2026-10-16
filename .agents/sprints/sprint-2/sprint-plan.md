# Sprint 2 Plan: Role Deliverables & Artifacts Showcase

## Sprint Details
- **Sprint ID**: `sprint-2`
- **Path**: `.agents/sprints/sprint-2/`
- **Status**: Active
- **Sprint Goal**: In the Virtual Office UI, expose all artifacts produced across the lifecycle (PM PRD, Tech Lead Architecture & Implementation Plan, Dev Code/PR Deliverables, QA Test Execution Reports) in a dedicated section grouped by role, with interactive modal preview, markdown rendering, and file links.

## 4-Stage Task Decomposition
1. **`PLAN-201`** (In Progress): *Plan: Role Deliverables Hub* -> Assigned to `web-tech-lead`
   - Define data model for artifacts per sprint (`.agents/sprints/<sprintId>/artifacts.json` & directory).
   - Architectural specification for backend endpoints (`GET /api/sprints/artifacts`, `GET /api/artifacts/:id/content`).
   - UI UX design for role grouping cards (`tech-pm`, `web-tech-lead`, `web-dev`, `web-tester`).

2. **`CODE-201`** (Backlog): *Build: Role Deliverables UI & API* -> Assigned to `web-dev`
   - Implement backend artifact scanning and indexing in `server/watchers.js` and `server/index.js`.
   - Create frontend component `src/components/RoleDeliverablesSection.tsx` and integrate into `App.tsx`.
   - Provide file view modal with Markdown rendering, syntax highlighted code/diffs, and direct file paths.

3. **`REVIEW-201`** (Backlog): *Review: Role Deliverables & Contracts* -> Assigned to `web-tech-lead`
   - Audit code quality, TypeScript contracts in `office.ts`, and component ergonomics.
   - Verify non-breaking layout with Virtual Office canvas and Kanban board.

4. **`TEST-201`** (Backlog): *Test: Role Deliverables Verification* -> Assigned to `web-tester`
   - Author end-to-end and component tests verifying artifact grouping, role metadata, and preview modal functionality.
