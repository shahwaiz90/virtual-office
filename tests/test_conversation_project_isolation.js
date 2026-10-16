const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const {
  resolveConversationProject,
  conversationProjectMatch,
  parseTranscriptStep,
  isPathInProject,
} = require('../server/watchers');
const { eventBus } = require('../server/eventBus');
const { getProjectRoot } = require('../server/agentDiscovery');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🧪 Cross-Project Event Isolation & Upfront Workspace Tests');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Clear cache & state
conversationProjectMatch.clear();
eventBus.clearState();

const currentRoot = getProjectRoot();
console.log(`Active Project Root: ${currentRoot}`);

// -------------------------------------------------------------
// Test 1: Workspace Resolution from Real SQLite DBs
// -------------------------------------------------------------
console.log('\n▶ Test 1: Testing SQLite Upfront Workspace Resolution...');

const quranSikhoConvId = '03361ead-d806-44ae-8635-b449aac29e61';
const virtualOfficeParentId = 'cd4ce1e1-47cd-4d08-aa3f-377c28f6a870';
const virtualOfficeSubagentId = '51240cfd-6e9a-4782-a578-1aeea2de6d7e';
const nonExistentId = '00000000-0000-0000-0000-000000000000';

const quranMatch = resolveConversationProject(quranSikhoConvId);
console.log(`  - QuranSikho (${quranSikhoConvId}): ${quranMatch}`);
assert.strictEqual(quranMatch, false, 'QuranSikho conversation must resolve to false for Virtual Office');

const voParentMatch = resolveConversationProject(virtualOfficeParentId);
console.log(`  - Virtual Office Parent (${virtualOfficeParentId}): ${voParentMatch}`);
assert.strictEqual(voParentMatch, true, 'Virtual Office Parent conversation must resolve to true');

const voSubMatch = resolveConversationProject(virtualOfficeSubagentId);
console.log(`  - Virtual Office Subagent (${virtualOfficeSubagentId}): ${voSubMatch}`);
assert.strictEqual(voSubMatch, true, 'Virtual Office Subagent conversation must resolve to true');

const nonExistentMatch = resolveConversationProject(nonExistentId);
console.log(`  - Non-existent conversation (${nonExistentId}): ${nonExistentMatch}`);
assert.strictEqual(nonExistentMatch, undefined, 'Non-existent conversation must resolve to undefined');

console.log('  ✅ Test 1 Passed: Upfront workspace resolution accurately distinguishes projects.');

// -------------------------------------------------------------
// Test 2: Foreign Project USER_INPUT step MUST NOT emit cards or events
// -------------------------------------------------------------
console.log('\n▶ Test 2: Foreign USER_INPUT Prompt Event Isolation...');

conversationProjectMatch.clear();
eventBus.clearState();

let eventCount = 0;
const testListener = () => {
  eventCount++;
};
eventBus.on('event', testListener);

const foreignUserInputStep = {
  type: 'USER_INPUT',
  source: 'USER_EXPLICIT',
  content: '<USER_REQUEST>Fix Arabic Quran font rendering and Tajweed audio recitation</USER_REQUEST>',
  created_at: new Date().toISOString(),
};

// Simulate step arriving for QuranSikho conversation
parseTranscriptStep(foreignUserInputStep, quranSikhoConvId);

// Assert: No tasks should have been created on Virtual Office task board!
assert.strictEqual(eventBus.tasks.size, 0, 'Foreign project prompt must NOT create any tasks in Virtual Office');
assert.strictEqual(eventCount, 0, 'Foreign project prompt must NOT emit any agent_events in Virtual Office');
assert.strictEqual(conversationProjectMatch.get(quranSikhoConvId), false, 'QuranSikho must be cached as false');

console.log('  ✅ Test 2 Passed: Foreign project USER_INPUT prompt was strictly blocked.');

// -------------------------------------------------------------
// Test 3: Foreign Project Role Header, Handoff & Tool Calls MUST NOT emit events
// -------------------------------------------------------------
console.log('\n▶ Test 3: Foreign Project Persona, Handoff & Tool Call Isolation...');

const foreignRoleStep = {
  type: 'SYSTEM_MESSAGE',
  content: '🎭 **Active Role**: **Android Developer** (`android-dev`)',
};
parseTranscriptStep(foreignRoleStep, quranSikhoConvId);
assert.strictEqual(eventCount, 0, 'Foreign role step must NOT emit events');

const foreignHandoffStep = {
  type: 'PLANNER_RESPONSE',
  content: '[AGENT HANDOFF]\nFROM: android-pm\nTO: android-dev\nACTIVE_TASK: Setup Quran audio\nALLOWED_SKILL: compose',
};
parseTranscriptStep(foreignHandoffStep, quranSikhoConvId);
assert.strictEqual(eventCount, 0, 'Foreign handoff step must NOT emit events');

const foreignSubagentStep = {
  type: 'SYSTEM_MESSAGE',
  source: 'SYSTEM',
  content: '<SYSTEM_MESSAGE>Subagent android-dev has COMPLETED the task.</SYSTEM_MESSAGE>',
};
parseTranscriptStep(foreignSubagentStep, quranSikhoConvId);
assert.strictEqual(eventCount, 0, 'Foreign subagent completion step must NOT emit events');

console.log('  ✅ Test 3 Passed: All foreign agent lifecycle steps strictly blocked.');

// -------------------------------------------------------------
// Test 4: Current Project USER_INPUT step MUST create cards and emit events
// -------------------------------------------------------------
console.log('\n▶ Test 4: Current Workspace USER_INPUT Allowed & Delivered...');

conversationProjectMatch.clear();
eventBus.clearState();
eventCount = 0;

const localUserInputStep = {
  type: 'USER_INPUT',
  source: 'USER_EXPLICIT',
  content: '<USER_REQUEST>Implement Virtual Office cross-project isolation</USER_REQUEST>',
  created_at: new Date().toISOString(),
};

parseTranscriptStep(localUserInputStep, virtualOfficeParentId);

assert.strictEqual(conversationProjectMatch.get(virtualOfficeParentId), true, 'Virtual Office must be cached as true');
assert(eventCount > 0, 'EventBus must emit intake event for current project');

console.log(`  - Verified project match and emitted ${eventCount} intake events`);
console.log('  ✅ Test 4 Passed: Current workspace events processed cleanly.');

// -------------------------------------------------------------
// Test 5: Synthetic DB Fallback Buffer Scan Verification
// -------------------------------------------------------------
console.log('\n▶ Test 5: Buffer Scan Fallback Verification on Synthetic DB...');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-test-db-'));
const syntheticForeignId = '99999999-aaaa-bbbb-cccc-999999999999';
const syntheticLocalId = '88888888-aaaa-bbbb-cccc-888888888888';

const convsDir = path.join(os.homedir(), '.gemini/antigravity/conversations');
const foreignDbPath = path.join(convsDir, `${syntheticForeignId}.db`);
const localDbPath = path.join(convsDir, `${syntheticLocalId}.db`);

try {
  // Create synthetic DB files with embedded workspace URIs
  const foreignUri = Buffer.from('file:///Users/otheruser/SomeOtherProject', 'utf8');
  const localUri = Buffer.from(`file://${currentRoot}`, 'utf8');

  // Fill binary padding then write URI
  const foreignBuf = Buffer.alloc(4096);
  Buffer.from('SQLite format 3\x00').copy(foreignBuf, 0);
  foreignUri.copy(foreignBuf, 256);
  fs.writeFileSync(foreignDbPath, foreignBuf);

  const localBuf = Buffer.alloc(4096);
  Buffer.from('SQLite format 3\x00').copy(localBuf, 0);
  localUri.copy(localBuf, 256);
  fs.writeFileSync(localDbPath, localBuf);

  conversationProjectMatch.clear();

  const synthForeignMatch = resolveConversationProject(syntheticForeignId);
  assert.strictEqual(synthForeignMatch, false, 'Synthetic foreign DB must resolve to false');

  const synthLocalMatch = resolveConversationProject(syntheticLocalId);
  assert.strictEqual(synthLocalMatch, true, 'Synthetic local DB must resolve to true');

  console.log('  ✅ Test 5 Passed: Direct buffer scan fallback verified for synthetic DBs.');
} finally {
  // Clean up synthetic DB files
  try { if (fs.existsSync(foreignDbPath)) fs.unlinkSync(foreignDbPath); } catch (e) {}
  try { if (fs.existsSync(localDbPath)) fs.unlinkSync(localDbPath); } catch (e) {}
  try { fs.rmdirSync(tempDir); } catch (e) {}
}

eventBus.removeListener('event', testListener);

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🎉 ALL CROSS-PROJECT EVENT ISOLATION TESTS PASSED (100%)!');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
