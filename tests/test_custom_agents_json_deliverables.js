const assert = require('assert');
const { parseTranscriptStep, ensureRoleDeliverables } = require('../server/watchers');
const { eventBus } = require('../server/eventBus');

console.log('🧪 Starting Custom agents.json Dynamic Deliverables Test...\n');

// 1. Simulate exact agents loaded from enterprise-android/.agents/agents.json
eventBus.clearState();
eventBus.isDemoRunning = true;
eventBus.agents.clear();

const customAndroidAgents = [
  {
    id: 'project-manager',
    name: 'Project Manager & Delivery Lead',
    role: 'Single Accountable Owner / Team Lead',
    badge: 'PM',
    description: 'Manages project intake, scopes requirements, and delivers final reports.',
    skills: ['jira-agent', '00-requirement-analysis', 'pm-reporting'],
    allowed_tools: ['view_file', 'invoke_subagent'],
    delegation_targets: ['android-tech-lead', 'android-dev'],
  },
  {
    id: 'android-tech-lead',
    name: 'Android Technical Lead',
    role: 'Technical Architect & Code Reviewer',
    badge: 'ARCH',
    description: 'Plans architecture boundaries, pre-maps impacted files, and conducts code reviews.',
    skills: ['00-architecture', '01-feature-analysis', 'tech-lead-planning', '10-code-review'],
    allowed_tools: ['view_file', 'git_diff'],
    delegation_targets: ['android-dev', 'android-tester'],
  },
  {
    id: 'android-dev',
    name: 'Android Feature Developer',
    role: 'Sole Code Author & Builder',
    badge: 'DEV',
    description: 'Sole code author: implements feature layers, writes unit tests.',
    skills: ['02-compose-screen', '03-viewmodel', '04-repository', '08-unit-tests'],
    allowed_tools: ['write_to_file', 'replace_file_content'],
    delegation_targets: ['android-tech-lead'],
  },
  {
    id: 'android-tester',
    name: 'Android QA & Test Engineer',
    role: 'Quality Assurance & Test Verification',
    badge: 'QA',
    description: 'Executes automated test suites and validates regressions.',
    skills: ['testDebugUnitTest'],
    allowed_tools: ['./gradlew testDebugUnitTest'],
    delegation_targets: ['android-dev', 'project-manager'],
  },
];

for (const a of customAndroidAgents) {
  eventBus.agents.set(a.id, a);
}

// 2. Trigger deliverables creation
ensureRoleDeliverables('Company Profile Screen');

const tasks = Array.from(eventBus.tasks.values());
console.log(`Discovered ${tasks.length} dynamic deliverables from custom agents.json:`);
for (const t of tasks) {
  console.log(`  - [${t.key}] ${t.title}`);
  console.log(`      Assigned To: ${t.assignedTo}`);
  console.log(`      Delegated By: ${t.delegatedBy} (${t.delegatedByRole})`);
  console.log(`      Skill: ${t.skill}`);
  console.log(`      Description: ${t.description}`);
}

// Assertions: All fields must strictly derive from custom agents.json!
const arch = eventBus.tasks.get('DELIV-1');
assert.strictEqual(arch.assignedTo, 'android-tech-lead', 'Must assign to android-tech-lead from agents.json');
assert.strictEqual(arch.delegatedBy, 'project-manager', 'Must delegate from project-manager based on delegation_targets');
assert.strictEqual(arch.delegatedByRole, 'Single Accountable Owner / Team Lead', 'Role must match agents.json');
assert(arch.title.includes('Architecture'), 'Title must derive from 00-architecture skill');

const dev = eventBus.tasks.get('DELIV-2');
assert.strictEqual(dev.assignedTo, 'android-dev', 'Must assign to android-dev from agents.json');
assert.strictEqual(dev.delegatedBy, 'android-tech-lead', 'Must delegate from android-tech-lead based on delegation_targets');
assert.strictEqual(dev.delegatedByRole, 'Technical Architect & Code Reviewer', 'Role must match agents.json');
assert(dev.title.includes('Compose Screen'), 'Title must derive from 02-compose-screen skill');

const qa = eventBus.tasks.get('DELIV-3');
assert.strictEqual(qa.assignedTo, 'android-tester', 'Must assign to android-tester from agents.json');
assert.strictEqual(qa.delegatedBy, 'android-tech-lead', 'Must delegate from android-tech-lead based on delegation_targets');
assert.strictEqual(qa.delegatedByRole, 'Technical Architect & Code Reviewer', 'Role must match agents.json');
assert(qa.title.includes('Test Debug Unit Test'), 'Title must derive from testDebugUnitTest skill');

const rev = eventBus.tasks.get('DELIV-4');
assert.strictEqual(rev.assignedTo, 'android-tech-lead', 'Review must assign to android-tech-lead');
assert.strictEqual(rev.delegatedBy, 'android-dev', 'Review must delegate from android-dev');
assert.strictEqual(rev.delegatedByRole, 'Sole Code Author & Builder', 'Role must match agents.json');

const rel = eventBus.tasks.get('DELIV-5');
assert.strictEqual(rel.assignedTo, 'project-manager', 'Release sign-off must assign to project-manager');
assert.strictEqual(rel.delegatedBy, 'android-tester', 'Release must delegate from android-tester');
assert.strictEqual(rel.delegatedByRole, 'Quality Assurance & Test Verification', 'Role must match agents.json');

console.log('\n🎉 ALL CUSTOM AGENTS.JSON DELIVERABLE ASSERTIONS PASSED 100%!');
