---
name: requirement-analysis
description: Turns a user request, ticket or spec into a bounded requirement with testable acceptance criteria before it is broken into tasks.
---
# Requirement Analysis

Do this before `task-decomposition`. Record the outcome on the requirement card (`kanban-handoff`): scope in the description, criteria in `acceptanceCriteria`, open questions on the thread.

1. **Need**: who wants what, and why. One sentence; the success measure if there is one.
2. **Sources**: read the linked ticket or spec (`read-jira`, `read-confluence`) and the code that it touches.
3. **Scope**: what is in, what is explicitly out.
4. **Constraints**: platforms, compatibility, performance or security limits, existing contracts.
5. **Edge cases**: empty, error, offline/failure, permission and large-data states.
6. **Acceptance criteria**: each one observable and testable, written in user terms. Ask the user rather than guess when a criterion can't be pinned down.
