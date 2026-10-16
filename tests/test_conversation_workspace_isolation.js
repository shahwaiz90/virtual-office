const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const {
  resolveConversationProject,
  conversationProjectMatch,
  parseTranscriptStep,
  isPathInProject,
  cleanExtractedUri,
} = require('../server/watchers');
const { eventBus } = require('../server/eventBus');
const { getProjectRoot, setProjectRoot } = require('../server/agentDiscovery');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🧪 Automated Multi-Project & Workspace Isolation Suite');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const virtualOfficeRoot = path.resolve('/Users/ahmadshahwaiz/Desktop/Virtual Office');
const quranSikhoRoot = path.resolve('/Users/ahmadshahwaiz/Documents/EasyQuran/QuranSikho');

// Ensure starting in Virtual Office
setProjectRoot(virtualOfficeRoot);
conversationProjectMatch.clear();
eventBus.clearState();

console.log(`Initial Active Project Root: ${getProjectRoot()}`);

// =========================================================================
// Suite 1: Path Matching Matrix under Dynamic Project Roots
// =========================================================================
console.log('\n▶ Suite 1: Path Matching Matrix under Dynamic Project Roots');

// 1a: Virtual Office paths under Virtual Office root -> true
setProjectRoot(virtualOfficeRoot);
const voMatchVo = isPathInProject(path.join(virtualOfficeRoot, 'server/watchers.js'));
console.log(`  1a. Virtual Office path under Virtual Office root: ${voMatchVo}`);
assert.strictEqual(voMatchVo, true, 'Virtual Office paths under Virtual Office root must be true');

// 1b: QuranSikho paths under Virtual Office root -> false
const qsMatchVo = isPathInProject(path.join(quranSikhoRoot, 'app/src/main/MainActivity.kt'));
console.log(`  1b. QuranSikho path under Virtual Office root: ${qsMatchVo}`);
assert.strictEqual(qsMatchVo, false, 'QuranSikho paths under Virtual Office root must be false');

// 1c: Virtual Office paths under QuranSikho root -> false
setProjectRoot(quranSikhoRoot);
const voMatchQs = isPathInProject(path.join(virtualOfficeRoot, 'server/watchers.js'));
console.log(`  1c. Virtual Office path under QuranSikho root: ${voMatchQs}`);
assert.strictEqual(voMatchQs, false, 'Virtual Office paths under QuranSikho root must be false');

// 1d: QuranSikho paths under QuranSikho root -> true
const qsMatchQs = isPathInProject(path.join(quranSikhoRoot, 'app/src/main/MainActivity.kt'));
console.log(`  1d. QuranSikho path under QuranSikho root: ${qsMatchQs}`);
assert.strictEqual(qsMatchQs, true, 'QuranSikho paths under QuranSikho root must be true');

// Reset project root back to Virtual Office
setProjectRoot(virtualOfficeRoot);
console.log('  ✅ Suite 1 Passed: Bi-directional path isolation verified 100%.');

// =========================================================================
// Suite 2: URI Cleaning & Protobuf Tag Stripping Edge Cases
// =========================================================================
console.log('\n▶ Suite 2: Protobuf Artifact & URI Cleanup Edge Cases');

// Test 2a: Trailing binary protobuf tag 'B\ufffd%'
const rawWithB = 'Users/ahmadshahwaiz/Desktop/Virtual%20OfficeB\ufffd%';
const cleanedB = cleanExtractedUri(rawWithB);
console.log(`  2a. Raw: "${rawWithB}" -> Cleaned: "${cleanedB}"`);
assert.strictEqual(cleanedB, virtualOfficeRoot, 'Protobuf B tag and URL encoding must be cleanly stripped to project root');

// Test 2b: Trailing protobuf tag 'z\ufffd'
const rawWithZ = 'Users/ahmadshahwaiz/Desktop/Virtual%20Officez\ufffd';
const cleanedZ = cleanExtractedUri(rawWithZ);
console.log(`  2b. Raw: "${rawWithZ}" -> Cleaned: "${cleanedZ}"`);
assert.strictEqual(cleanedZ, virtualOfficeRoot, 'Protobuf z tag must be stripped to project root');

// Test 2c: Trailing markdown brackets '))'
const rawWithMarkdown = 'Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/task-decomposition/SKILL.md))';
const cleanedMd = cleanExtractedUri(rawWithMarkdown);
console.log(`  2c. Raw markdown artifacts -> Cleaned: "${cleanedMd}"`);
assert.strictEqual(
  cleanedMd,
  path.join(virtualOfficeRoot, '.agents/skills/task-decomposition/SKILL.md'),
  'Trailing markdown parentheses must be stripped'
);

console.log('  ✅ Suite 2 Passed: Protobuf and markdown URI cleanup verified.');

// =========================================================================
// Suite 3: Real Antigravity Conversation SQLite DB Verification
// =========================================================================
console.log('\n▶ Suite 3: Real Antigravity Conversation SQLite DB Resolution');

const quranSikhoConvId = '03361ead-d806-44ae-8635-b449aac29e61';
const virtualOfficeConvId = '116e4808-3b7b-4060-9884-ec4c70826ee7';
const nonExistentConvId = 'ffffffff-0000-0000-0000-000000000000';

conversationProjectMatch.clear();

// 3a: Verify QuranSikho DB resolves to FALSE under Virtual Office root
const qsResolved = resolveConversationProject(quranSikhoConvId);
console.log(`  3a. QuranSikho DB (${quranSikhoConvId}): ${qsResolved}`);
assert.strictEqual(qsResolved, false, 'QuranSikho DB must resolve to false for Virtual Office');
assert.strictEqual(conversationProjectMatch.get(quranSikhoConvId), false, 'QuranSikho must be cached as false');

// 3b: Verify Virtual Office DB resolves to TRUE under Virtual Office root
const voResolved = resolveConversationProject(virtualOfficeConvId);
console.log(`  3b. Virtual Office DB (${virtualOfficeConvId}): ${voResolved}`);
assert.strictEqual(voResolved, true, 'Virtual Office DB must resolve to true for Virtual Office');
assert.strictEqual(conversationProjectMatch.get(virtualOfficeConvId), true, 'Virtual Office must be cached as true');

// 3c: Non-existent DB resolves to undefined
const nonExistentResolved = resolveConversationProject(nonExistentConvId);
console.log(`  3c. Non-existent DB (${nonExistentConvId}): ${nonExistentResolved}`);
assert.strictEqual(nonExistentResolved, undefined, 'Non-existent DB must resolve to undefined');

console.log('  ✅ Suite 3 Passed: Real SQLite DB upfront isolation verified.');

// =========================================================================
// Suite 4: USER_INPUT Step Gating & EventBus Isolation
// =========================================================================
console.log('\n▶ Suite 4: Foreign USER_INPUT Prompt Event Discard Verification');

conversationProjectMatch.clear();
eventBus.clearState();

let emittedEvents = [];
const eventTracker = (e) => emittedEvents.push(e);
eventBus.on('event', eventTracker);

// 4a: Send foreign USER_INPUT from QuranSikho conversation
const foreignPromptStep = {
  type: 'USER_INPUT',
  source: 'USER_EXPLICIT',
  content: '<USER_REQUEST>Fix Quran reciter audio playback buffering issue</USER_REQUEST>',
  created_at: new Date().toISOString(),
};

parseTranscriptStep(foreignPromptStep, quranSikhoConvId);

// Assert: eventBus must NOT have received ANY tasks or agent_active events
assert.strictEqual(eventBus.tasks.size, 0, 'Foreign project prompt must NOT create tasks on Virtual Office board');
assert.strictEqual(
  emittedEvents.filter((e) => e.type === 'agent_active').length,
  0,
  'Foreign project prompt must NOT emit agent_active events'
);
assert.strictEqual(emittedEvents.length, 0, 'Zero events should be emitted for foreign prompt');

console.log('  4a. Foreign USER_INPUT safely discarded with 0 tasks and 0 events.');

// 4b: Send unverified USER_INPUT from non-existent conversation
parseTranscriptStep(
  {
    type: 'USER_INPUT',
    source: 'USER_EXPLICIT',
    content: '<USER_REQUEST>Unverified unknown prompt</USER_REQUEST>',
    created_at: new Date().toISOString(),
  },
  nonExistentConvId
);

assert.strictEqual(eventBus.tasks.size, 0, 'Unverified conversation prompt must NOT create tasks');
assert.strictEqual(emittedEvents.length, 0, 'Zero events should be emitted for unverified prompt');

console.log('  4b. Unverified USER_INPUT safely discarded with 0 tasks and 0 events.');

// 4c: Send valid local USER_INPUT from Virtual Office conversation
const localPromptStep = {
  type: 'USER_INPUT',
  source: 'USER_EXPLICIT',
  content: '<USER_REQUEST>Complete multi-project instance isolation engineering sprint</USER_REQUEST>',
  created_at: new Date().toISOString(),
};

parseTranscriptStep(localPromptStep, virtualOfficeConvId);

// Assert: Emitted agent_active event for local intake
const localActiveEvents = emittedEvents.filter((e) => e.type === 'agent_active');
assert(localActiveEvents.length > 0, 'Local Virtual Office prompt must emit agent_active intake event');

console.log(`  4c. Local USER_INPUT accepted: emitted ${localActiveEvents.length} agent_active events.`);

eventBus.removeListener('event', eventTracker);
console.log('  ✅ Suite 4 Passed: Strict eventBus isolation verified for USER_INPUT.');

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🎉 ALL MULTI-PROJECT WORKSPACE ISOLATION TESTS PASSED (100%)!');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
