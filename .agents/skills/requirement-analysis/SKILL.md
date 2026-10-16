---
name: requirement-analysis
description: Systematic methodology for ingesting, validating, and decomposing business requirements, user stories, and acceptance criteria into actionable technical engineering tasks.
---
# Product Requirement Analysis

## Purpose
Ensures all incoming feature requests, user stories, bug tickets, and architectural initiatives are thoroughly understood, bounded, and validated before technical breakdown.

## Core Workflow
0. **Backlog Registration**: Immediately log every incoming user feature request into the Authoritative Task Board `backlog` queue before starting scope ingestion, and schedule execution strictly after the current in-progress task finishes.
1. **Scope Ingestion**: Parse user story or ticket requirements, identify core business objectives, stakeholders, and success metrics.
2. **Constraint Verification**: Audit technical constraints (platform target, minimum OS version, performance SLAs, backward compatibility).
3. **Edge Case Mapping**: Explicitly enumerate boundary conditions, network failure handling, error states, and empty states.
4. **Acceptance Criteria Validation**: Ensure all acceptance criteria are testable, unambiguous, and mapped to verification tests.
