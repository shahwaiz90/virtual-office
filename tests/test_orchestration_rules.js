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

test('OrchestrationRules: no hardcoded breakdown — raw requirement becomes ONE backlog card for the orchestrator', () => {
  const roster = [
    { id: 'pm-1', name: 'Scrum Master', badge: 'PM', is_primary: true },
    { id: 'lead-1', name: 'Tech Lead', badge: 'LEAD' },
    { id: 'dev-1', name: 'Developer', badge: 'DEV' },
  ];
  const goal = 'Let users export the Kanban board as CSV';
  const tasks = OrchestrationRules.decomposeSprintGoal(goal, roster);
  assert.equal(tasks.length, 1, 'Without an AI breakdown nothing must be invented');
  assert.equal(tasks[0].assignedTo, 'pm-1');
  assert.equal(tasks[0].column, 'backlog');
  assert.equal(tasks[0].description, goal);
  assert.equal(tasks[0].needsBreakdown, true);
  assert.ok(!/^(Plan|Build|Review|Test):/.test(tasks[0].title), 'No template prefixes');
});

test('OrchestrationRules: normalizeAITasks keeps the AI breakdown exactly (any count, titles, assignees)', () => {
  const roster = [
    { id: 'tech-pm', is_primary: true, delegation_targets: ['web-tech-lead'] },
    { id: 'web-tech-lead' },
    { id: 'web-dev' },
  ];
  const ai = [
    { title: 'Define CSV columns for task export', assignedTo: 'web-tech-lead', skill: 'task-decomposition' },
    { title: 'Add GET /api/tasks/export.csv endpoint', assignedTo: 'web-dev', dependsOn: ['Define CSV columns for task export'] },
    { title: 'Add Export button to Kanban header', assignedTo: 'web-dev' },
    { title: 'Review export output and edge cases', assignedTo: 'web-tech-lead' },
    { title: 'Write e2e test for export', assignedTo: 'web-tester' },
  ];
  const tasks = OrchestrationRules.normalizeAITasks(ai, roster, { existingTasks: [{ key: 'WEB-212' }] });
  assert.equal(tasks.length, 5, 'Task count comes from the AI, not a template');
  assert.deepEqual(tasks.map((t) => t.title), ai.map((t) => t.title), 'Titles preserved verbatim');
  assert.equal(tasks[1].assignedTo, 'web-dev');
  assert.deepEqual(tasks[1].dependsOn, ['Define CSV columns for task export']);
  assert.equal(tasks[4].assignedTo, 'web-tech-lead', 'Unknown agent falls back to orchestrator delegation target');
  assert.equal(tasks[0].key, 'WEB-213', 'Keys continue after the highest existing key');
  assert.equal(new Set(tasks.map((t) => t.key)).size, 5, 'Keys are unique');

  const single = OrchestrationRules.normalizeAITasks([{ title: 'Fix typo in Settings title', assignedTo: 'web-dev' }], roster);
  assert.equal(single.length, 1, 'A small requirement may be a single task');
});

test('OrchestrationRules: distillShortTopic never maps keywords to canned titles', () => {
  assert.equal(OrchestrationRules.distillShortTopic('Build biometrics authentication'), 'Build biometrics authentication');
  assert.equal(OrchestrationRules.distillShortTopic('**Add sprint picker**'), 'Add sprint picker');
  assert.ok(OrchestrationRules.distillShortTopic('word '.repeat(40)).length <= 80);
});

test('OrchestrationRules: no demo task, file-change or communication templates exist', () => {
  for (const seed of ['getInitialDemoTasks', 'getDefaultFileChanges', 'getDefaultCommunications']) {
    assert.equal(typeof OrchestrationRules[seed], 'undefined', `${seed} must not exist`);
  }
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

test('OrchestrationRules: sanitizeTaskKey and exact AI task title preservation', () => {
  const { sanitizeTaskKey, parseRealTasksFromContent, registerRealAgentTask, syncTasksFromJson } = require('../server/watchers.js');
  const { eventBus } = require('../server/eventBus.js');

  // 1. sanitizeTaskKey
  assert.equal(sanitizeTaskKey('SPIKE-331'), 'SPIKE-331', 'Agent keys are not rewritten');
  assert.equal(sanitizeTaskKey(' `REV-202` '), 'REV-202');
  assert.equal(sanitizeTaskKey('TASK-303'), 'TASK-303');

  // 2. Exact AI title preservation from markdown table
  const sampleMarkdown = `
| Task Key | Title | Assignee | Status |
| :--- | :--- | :--- | :--- |
| PLAN-351 | Design Biometrics Auth Flow | web-tech-lead | in_progress |
| DEV-352 | Implement Biometrics Helper | web-dev | assigned |
| REVIEW-353 | Review Biometrics Security | web-tech-lead | backlog |
| QA-354 | Verify Biometrics Passkey Tests | web-tester | backlog |
`;

  const parsed = parseRealTasksFromContent(sampleMarkdown);
  assert.equal(parsed.length, 4);
  assert.equal(parsed[0].title, 'Design Biometrics Auth Flow', 'Must preserve exact AI title without keyword overwrite');
  assert.equal(parsed[1].title, 'Implement Biometrics Helper', 'Must preserve exact AI title without keyword overwrite');
  assert.equal(parsed[0].key, 'PLAN-351');

  // 3. registerRealAgentTask keeps the agent's key and title exactly
  const spikeTask = registerRealAgentTask({
    key: 'SPIKE-999',
    title: 'Spike Investigation and Findings on WebAuthn',
    assignedTo: 'web-tech-lead',
    column: 'in_progress',
  }, { skipPersist: true });
  const storedSpike = eventBus.tasks.get(spikeTask.id);
  assert.ok(storedSpike, 'Task must be registered and not deleted');
  assert.equal(storedSpike.key, 'SPIKE-999', 'Key must be preserved');
  assert.equal(storedSpike.title, 'Spike Investigation and Findings on WebAuthn', 'Title must be preserved verbatim');
  eventBus.tasks.delete(spikeTask.id);

  // 4. Exact AI title without Spike is preserved 100%
  const aiTask = registerRealAgentTask({
    key: 'DEV-888',
    title: 'Setup WebAuthn Passkey Credentials Storage',
    assignedTo: 'web-dev',
    column: 'assigned',
  }, { skipPersist: true });
  const storedAi = eventBus.tasks.get(aiTask.id);
  assert.ok(storedAi, 'AI Task must be registered');
  assert.equal(storedAi.title, 'Setup WebAuthn Passkey Credentials Storage', 'Exact AI title must be preserved');
  eventBus.tasks.delete(aiTask.id);
});
