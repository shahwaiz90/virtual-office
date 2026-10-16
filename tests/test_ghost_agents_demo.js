const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { eventBus } = require('../server/eventBus');
const { demoSimulator } = require('../server/demoSimulator');
const { generateGhostAgents } = require('../server/agentDiscovery');

console.log('🧪 Starting Ghost Agents & Demo Agentic Workflow Test Suite...\n');

// Snapshot disk files before test
const filesBefore = fs.readdirSync(process.cwd());

// ----------------------------------------------------------------------------
// Test 1: Ghost Agents Generation Structure & Contract
// ----------------------------------------------------------------------------
console.log('▶ Test 1: Verifying generateGhostAgents() contract & visual attributes...');
const ghostAgents = generateGhostAgents();
assert.strictEqual(ghostAgents.length, 4, 'Generates exactly 4 ghost agents');

const [pm, lead, dev, qa] = ghostAgents;

// 1. Scrum Master
assert.strictEqual(pm.id, 'tech-pm');
assert.strictEqual(pm.name, 'Scrum Master');
assert.strictEqual(pm.role, 'Scrum Master');
assert.strictEqual(pm.badge, 'PM');
assert.strictEqual(pm.badgeText, 'PM');
assert.strictEqual(pm.avatarUrl, '/assets/pm.png');
assert.strictEqual(pm.isPrimary, true);
assert.strictEqual(pm.is_primary, true);
assert.ok(pm.theme, 'Has theme object');
assert.strictEqual(pm.theme.station, 'tech-pm-station');
assert.strictEqual(pm.theme.stationName, 'Scrum Master Station');
assert.strictEqual(pm.theme.isPrimary, true);
assert.ok(pm.theme.deskPosition.x && pm.theme.deskPosition.y, 'Has desk position');
assert.ok(pm.theme.roomBounds.w && pm.theme.roomBounds.h, 'Has room bounds');
assert.strictEqual(pm.status, 'available');
assert.deepStrictEqual(pm.currentPosition, pm.theme.deskPosition);
assert.deepStrictEqual(pm.targetPosition, pm.theme.deskPosition);

// 2. Technical Lead
assert.strictEqual(lead.id, 'tech-lead');
assert.strictEqual(lead.name, 'Technical Lead');
assert.strictEqual(lead.role, 'Technical Lead');
assert.strictEqual(lead.badge, 'LEAD');
assert.strictEqual(lead.badgeText, 'LEAD');
assert.strictEqual(lead.avatarUrl, '/assets/techlead.png');
assert.strictEqual(lead.isPrimary, false);
assert.strictEqual(lead.is_primary, false);
assert.strictEqual(lead.theme.station, 'tech-lead-station');
assert.strictEqual(lead.theme.stationName, 'Technical Lead Station');
assert.strictEqual(lead.theme.isPrimary, false);

// 3. Feature Developer
assert.strictEqual(dev.id, 'core-dev');
assert.strictEqual(dev.name, 'Feature Developer');
assert.strictEqual(dev.role, 'Feature Developer');
assert.strictEqual(dev.badge, 'DEV');
assert.strictEqual(dev.badgeText, 'DEV');
assert.strictEqual(dev.avatarUrl, '/assets/developer.png');
assert.strictEqual(dev.isPrimary, false);
assert.strictEqual(dev.is_primary, false);
assert.strictEqual(dev.theme.station, 'core-dev-station');
assert.strictEqual(dev.theme.stationName, 'Feature Developer Station');

// 4. QA Tester
assert.strictEqual(qa.id, 'mobile-qa');
assert.strictEqual(qa.name, 'QA Tester');
assert.strictEqual(qa.role, 'QA Tester');
assert.strictEqual(qa.badge, 'QA');
assert.strictEqual(qa.badgeText, 'QA');
assert.strictEqual(qa.avatarUrl, '/assets/qa.png');
assert.strictEqual(qa.isPrimary, false);
assert.strictEqual(qa.is_primary, false);
assert.strictEqual(qa.theme.station, 'mobile-qa-station');
assert.strictEqual(qa.theme.stationName, 'QA Tester Station');

console.log('  ✅ Test 1 Passed: Ghost agents contract & visual attributes verified.\n');

// ----------------------------------------------------------------------------
// Test 2: Demo Simulator Start in Empty Workspace
// ----------------------------------------------------------------------------
console.log('▶ Test 2: Starting Demo Agentic Workflow when 0 agents exist...');

// Clear agents to simulate blank workspace
eventBus.agents.clear();
eventBus.tasks.clear();
demoSimulator.isGhostTeam = false;
eventBus.isGhostTeam = false;
assert.strictEqual(eventBus.agents.size, 0, 'Workspace starts with 0 agents');

// Start demo simulation
demoSimulator.start();

assert.strictEqual(demoSimulator.isGhostTeam, true, 'demoSimulator.isGhostTeam set to true');
assert.strictEqual(eventBus.isGhostTeam, true, 'eventBus.isGhostTeam set to true');
assert.strictEqual(eventBus.agents.size, 4, 'Ghost agents loaded into eventBus.agents');
assert.ok(eventBus.agents.has('tech-pm'), 'Has tech-pm');
assert.ok(eventBus.agents.has('tech-lead'), 'Has tech-lead');
assert.ok(eventBus.agents.has('core-dev'), 'Has core-dev');
assert.ok(eventBus.agents.has('mobile-qa'), 'Has mobile-qa');

const snapshot = eventBus.getStateSnapshot();
assert.strictEqual(snapshot.workflow.hasAgents, true, 'Snapshot reports hasAgents: true');
assert.strictEqual(snapshot.hasCustomAgentsConfig, true, 'Snapshot reports hasCustomAgentsConfig: true');
assert.strictEqual(snapshot.agents.length, 4, 'Snapshot includes 4 ghost agents');
assert.strictEqual(snapshot.isDemoRunning, true, 'Snapshot reports isDemoRunning: true');
assert.ok(snapshot.tasks.length > 0, 'Snapshot includes demo tasks');

console.log('  ✅ Test 2 Passed: Demo started with ghost team in-memory.\n');

// ----------------------------------------------------------------------------
// Test 3: Idempotency of resetWorkflow during ghost demo (No Wipe-out)
// ----------------------------------------------------------------------------
console.log('▶ Test 3: Verifying resetWorkflow does NOT wipe out ghost agents...');
eventBus.resetWorkflow('TEST WORKFLOW RESET');
assert.strictEqual(eventBus.agents.size, 4, 'Ghost agents preserved across resetWorkflow');
assert.strictEqual(eventBus.isGhostTeam, true, 'isGhostTeam remains true');
assert.ok(eventBus.agents.has('tech-pm'), 'tech-pm still present');

console.log('  ✅ Test 3 Passed: resetWorkflow safely preserves ghost agents.\n');

// ----------------------------------------------------------------------------
// Test 4: Demo Simulator Stop in Ghost Team Mode (Clean Teardown)
// ----------------------------------------------------------------------------
console.log('▶ Test 4: Stopping Demo Agentic Workflow resets ghost team cleanly...');
demoSimulator.stop();

assert.strictEqual(demoSimulator.isGhostTeam, false, 'demoSimulator.isGhostTeam reset to false');
assert.strictEqual(eventBus.isGhostTeam, false, 'eventBus.isGhostTeam reset to false');
assert.strictEqual(eventBus.agents.size, 0, 'Ghost agents wiped from memory');
assert.strictEqual(eventBus.tasks.size, 0, 'Tasks cleared');

const stopSnapshot = eventBus.getStateSnapshot();
assert.strictEqual(stopSnapshot.workflow.hasAgents, false, 'Snapshot reports hasAgents: false');
assert.strictEqual(stopSnapshot.agents.length, 0, 'Snapshot reports 0 agents');
assert.strictEqual(stopSnapshot.metrics.totalAgents, 0, 'Snapshot metrics show 0 totalAgents');
assert.ok(stopSnapshot.workflow.milestone.includes('No agents found'), 'Milestone prompts to setup team');

console.log('  ✅ Test 4 Passed: Stop cleanly returned workspace to 0 agents.\n');

// ----------------------------------------------------------------------------
// Test 5: Zero Disk Pollution Verification
// ----------------------------------------------------------------------------
console.log('▶ Test 5: Verifying zero disk pollution...');
const filesAfter = fs.readdirSync(process.cwd());
assert.deepStrictEqual(filesBefore.sort(), filesAfter.sort(), 'No new files created in project root');

// Ensure no ghost agent definition was written to disk
assert.strictEqual(fs.existsSync(path.join(process.cwd(), '.agents/definitions/tech-lead.md')), false, 'No ghost tech-lead definition on disk');
assert.strictEqual(fs.existsSync(path.join(process.cwd(), '.agents/definitions/core-dev.md')), false, 'No ghost core-dev definition on disk');
assert.strictEqual(fs.existsSync(path.join(process.cwd(), '.agents/definitions/mobile-qa.md')), false, 'No ghost mobile-qa definition on disk');

console.log('  ✅ Test 5 Passed: Strictly zero disk pollution verified.\n');

// Restore eventBus for next test suites
eventBus.initAgents();
eventBus.clearState();

console.log('🎉 ALL GHOST AGENTS & DEMO AGENTIC WORKFLOW TESTS PASSED 100%!\n');
