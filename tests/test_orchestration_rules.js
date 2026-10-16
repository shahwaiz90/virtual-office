const test = require('node:test');
const assert = require('node:assert/strict');
const { OrchestrationRules } = require('../server/orchestrationRules.js');

test('OrchestrationRules: resolveTeamRoles prioritizes is_primary / isPrimary regardless of badge', () => {
  const customRoster = [
    { id: 'custom-lead', name: 'Custom Lead', badge: 'LEAD', is_primary: true },
    { id: 'custom-pm', name: 'Scrum Guy', badge: 'PM' },
    { id: 'custom-dev', name: 'Custom Dev', badge: 'DEV' },
    { id: 'custom-qa', name: 'Custom QA', badge: 'QA' },
  ];

  const roles = OrchestrationRules.resolveTeamRoles(customRoster);
  assert.equal(roles.pm.id, 'custom-lead', 'is_primary agent must become primary orchestrator (pm slot)');
  assert.equal(roles.lead.id, 'custom-pm', 'Non-primary lead slot fallback');
  assert.equal(roles.dev.id, 'custom-dev');
  assert.equal(roles.tester.id, 'custom-qa');
});

test('OrchestrationRules: platformBadge detection', () => {
  const androidRoster = [{ id: 'android-pm', name: 'Android PM' }];
  const iosRoster = [{ id: 'ios-lead', name: 'iOS Lead' }];
  const webRoster = [{ id: 'web-dev', name: 'Web Dev' }];
  const genericRoster = [{ id: 'agent-1', name: 'Agent One' }];

  assert.equal(OrchestrationRules.resolveTeamRoles(androidRoster).platformBadge, 'AND');
  assert.equal(OrchestrationRules.resolveTeamRoles(iosRoster).platformBadge, 'IOS');
  assert.equal(OrchestrationRules.resolveTeamRoles(webRoster).platformBadge, 'WEB');
  assert.equal(OrchestrationRules.resolveTeamRoles(genericRoster).platformBadge, 'TSK');
});

test('OrchestrationRules: decomposeSprintGoal generates 4 standard sprint tasks', () => {
  const roster = [
    { id: 'pm-1', name: 'Scrum Master', badge: 'PM' },
    { id: 'lead-1', name: 'Tech Lead', badge: 'LEAD' },
    { id: 'dev-1', name: 'Developer', badge: 'DEV' },
    { id: 'qa-1', name: 'Tester', badge: 'QA' },
  ];

  const tasks = OrchestrationRules.decomposeSprintGoal('Build biometrics authentication', roster);
  assert.equal(tasks.length, 4, 'Must produce 4 decomposed sprint tasks');

  // Verify task sequence
  assert.equal(tasks[0].assignedTo, 'lead-1');
  assert.equal(tasks[0].column, 'in_progress');
  assert.ok(tasks[0].title.includes('Architecture Spike'));

  assert.equal(tasks[1].assignedTo, 'dev-1');
  assert.equal(tasks[1].column, 'assigned');
  assert.ok(tasks[1].title.includes('Core Feature Implementation'));

  assert.equal(tasks[2].assignedTo, 'lead-1');
  assert.equal(tasks[2].column, 'backlog');
  assert.ok(tasks[2].title.includes('Quality Gate & Code Review'));

  assert.equal(tasks[3].assignedTo, 'qa-1');
  assert.equal(tasks[3].column, 'backlog');
  assert.ok(tasks[3].title.includes('Acceptance Verification'));
});

test('OrchestrationRules: getInitialDemoTasks returns 5 demo tasks', () => {
  const roster = [
    { id: 'pm-1', name: 'Scrum Master', badge: 'PM' },
    { id: 'lead-1', name: 'Tech Lead', badge: 'LEAD' },
    { id: 'dev-1', name: 'Developer', badge: 'DEV' },
    { id: 'qa-1', name: 'Tester', badge: 'QA' },
  ];

  const demoTasks = OrchestrationRules.getInitialDemoTasks(roster);
  assert.equal(demoTasks.length, 5);
  assert.equal(demoTasks[0].id, 'TASK-1');
  assert.equal(demoTasks[4].id, 'TASK-5');
});

test('OrchestrationRules: getDefaultFileChanges & getDefaultCommunications return non-empty datasets', () => {
  const roster = [
    { id: 'pm-1', name: 'Scrum Master', badge: 'PM' },
    { id: 'lead-1', name: 'Tech Lead', badge: 'LEAD' },
    { id: 'dev-1', name: 'Developer', badge: 'DEV' },
    { id: 'qa-1', name: 'Tester', badge: 'QA' },
  ];

  const fc = OrchestrationRules.getDefaultFileChanges(roster);
  assert.ok(fc.length >= 3);
  assert.ok(fc.every(f => f.filePath && f.agentId));

  const comms = OrchestrationRules.getDefaultCommunications(roster);
  assert.ok(comms.length >= 6);
  assert.ok(comms.every(c => c.fromAgentId && c.toAgentId && c.message));
});

test('OrchestrationRules: Robustness against Team Studio user renaming (Zero regex on name/role)', () => {
  // Simulate a user renaming all display names and roles in Team Studio
  const renamedRoster = [
    { id: 'tech-pm', name: 'Alice Smith', role: 'Executive Vice President', badge: 'SM' },
    { id: 'android-tech-lead', name: 'Bob Jones', role: 'Staff Visionary', badge: 'LEAD', enable_subagent_tools: true },
    { id: 'android-dev', name: 'Charlie Brown', role: 'Digital Craftsman', badge: 'DEV' },
    { id: 'android-tester', name: 'Diana Prince', role: 'Guardian of Releases', badge: 'QA' },
  ];

  const roles = OrchestrationRules.resolveTeamRoles(renamedRoster);
  assert.equal(roles.pm.id, 'tech-pm', 'tech-pm resolved by ID regardless of custom title');
  assert.equal(roles.lead.id, 'android-tech-lead', 'android-tech-lead resolved by ID regardless of custom title');
  assert.equal(roles.dev.id, 'android-dev', 'android-dev resolved by ID regardless of custom title');
  assert.equal(roles.tester.id, 'android-tester', 'android-tester resolved by ID regardless of custom title');
  assert.equal(roles.platformBadge, 'AND', 'Platform resolved by ID prefix');
});

test('OrchestrationRules: inferChannel determines channels strictly by agent IDs', () => {
  assert.equal(OrchestrationRules.inferChannel('android-dev', 'android-tech-lead'), 'pr_review');
  assert.equal(OrchestrationRules.inferChannel('ios-dev', 'ios-tech-lead'), 'pr_review');
  assert.equal(OrchestrationRules.inferChannel('tech-pm', 'android-tester'), 'qa_handoff');
  assert.equal(OrchestrationRules.inferChannel('android-tester', 'tech-pm'), 'qa_handoff');
  assert.equal(OrchestrationRules.inferChannel('tech-pm', 'android-tech-lead'), 'subagent_delegation');
  assert.equal(OrchestrationRules.inferChannel('any-from', 'any-to', 'custom_channel'), 'custom_channel');
});

