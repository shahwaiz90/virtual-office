---
name: task-decomposition
description: Deconstructs high-level user goals, feature requirements, or bug reports into discrete, sequenced engineering tasks (Architecture Spike -> Feature Implementation -> Code Review -> QA Acceptance Verification) and assigns them across team specialists on the Authoritative Task Board.
---
# Task Decomposition & Team Assignment

This skill guides Product Leads, Tech Leads, and Scrum Masters in breaking down high-level user goals into structured, actionable engineering tasks and assigning them directly to team specialists conforming to the 6-category agent specification standard.

## 1. 4-Stage Task Decomposition Workflow
When receiving any feature request or technical user story, break it down into 4 clear tasks:
1. **Architecture & Contract Spike**: Assigned to Tech Lead / System Architect. Maps impacted files, defines data contracts, verifies architectural patterns.
2. **Core Feature Implementation**: Assigned to Core Developer. Builds components, repositories, and state flows adhering to clean architecture.
3. **Quality Gate & Code Review**: Assigned to Tech Lead. Audits SOLID principles, verifies zero leaks or regressions.
4. **Automated QA & Acceptance Verification**: Assigned to QA Specialist. Authors unit/integration tests and verifies 100% green pass rate.

## 2. 6-Category Agent Specification Framework
All agents operating in the workspace must adhere to the standardized 6-category specification:

| Category | Attributes | Purpose & Responsibilities |
| :--- | :--- | :--- |
| **1. Identity** | `id`, `name`, `description`, `badge`, `avatar_url` | Uniquely identifies the agent across provider runtimes, CLI adapters, and the virtual office UI. |
| **2. Behavior** | `role`, `persona`, `goal`, `is_primary` | Defines operational temperament, architectural objectives, and whether the agent serves as Primary Orchestrator. |
| **3. Capabilities** | `skills`, `tools` (*alias: `allowed_tools`*), tool flags | Whitelists actionable tool permissions (`view_file`, `write_to_file`, `run_command`, etc.) and assigned domain skills. |
| **4. Execution** | `inputContract`, `outputContract` | Explicit preconditions, acceptance criteria, and deliverable schemas required for task handoffs. |
| **5. Governance** | `permissions`, `prohibited_actions` | Strict boundaries, safety guardrails, and role prohibitions (e.g. no direct code modification for PM/QA). |
| **6. Coordination** | `reportsTo`, `handoffTo` (*alias: `delegation_targets`*) | Directed routing graph specifying supervisory hierarchy and authorized delegation targets. |

## 3. Mapping 4-Stage Workflow to 6-Category Contracts

### Stage 1: Architecture & Contract Spike
- **Assignee**: `android-tech-lead` (Role: *System Architect & Code Reviewer*)
- **Input Contract**: High-level requirements, user stories, PRDs, and Jira/Confluence tickets from `android-pm`.
- **Output Contract**: Architectural spike report, contract definitions, file impact maps, and decomposed implementation work items.
- **Coordination**: Reports to `android-pm`; hands off to `android-dev`.

### Stage 2: Core Feature Implementation
- **Assignee**: `android-dev` (Role: *Feature & Compose Engineer*)
- **Input Contract**: Implementation contracts, UI mocks, and spike tasks assigned by Tech Lead.
- **Output Contract**: Working source code changes, build verifications, and task status transition to Review.
- **Coordination**: Reports to `android-tech-lead`; hands off to `android-tech-lead`.

### Stage 3: Quality Gate & Code Review
- **Assignee**: `android-tech-lead` (Role: *System Architect & Code Reviewer*)
- **Input Contract**: Feature implementation code, diffs, and developer summary.
- **Output Contract**: Code review approval, regression audit sign-off, or actionable revision items.
- **Coordination**: Reports to `android-pm`; hands off to `android-tester`.

### Stage 4: Automated QA & Acceptance Verification
- **Assignee**: `android-tester` (Role: *Test Automation & Verification*)
- **Input Contract**: Verified implementation branch, acceptance criteria, test specifications.
- **Output Contract**: Automated test suite logs (unit, integration, UI), zero-regression verification, task transitioned to Done.
- **Coordination**: Reports to `android-tech-lead`; hands off to `android-dev` (on defect) or `android-pm` (on completion).

## 4. Authoritative Task Board Integration
- Every decomposed task must be assigned a unique key (e.g. `AND-101`, `IOS-101`, `WEB-101`).
- Assign to the designated specialist role with clear scope of work and acceptance criteria matching `inputContract`.
- Tasks appear on the Authoritative Task Board in `backlog`, `assigned`, or `in_progress` columns.
- As specialists complete their work, tasks transition to `review`, `testing`, and `done` adhering to `outputContract`.

## 5. Communication & Handoff Protocols
- Always announce task breakdown to the team with clear acceptance criteria.
- Designate the upstream assigner (`delegatedBy` / `delegatedByRole`) and target specialist (`assignedTo`).
- Validate that all delegation transfers strictly follow the whitelisted `handoffTo` targets.
