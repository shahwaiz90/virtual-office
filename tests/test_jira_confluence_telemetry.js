const assert = require('assert');
const { EventBus } = require('../server/eventBus');

console.log('🧪 Starting Jira & Confluence Telemetry & Terminal Logs Test Suite...');

const testBus = new EventBus();

// Test 1: Record Jira Ticket Item
console.log('\n▶ Test 1: Recording Jira ticket lookup...');
const jiraItem = testBus.recordJiraConfluenceItem({
  sourceType: 'jira',
  ticketKey: 'PROJ-123',
  url: 'https://jira.example.com/browse/PROJ-123',
  title: 'Jira Ticket PROJ-123: Add CSV export endpoint',
  summary: 'CSV export endpoint for the active sprint',
  command: 'python3 scripts/read_jira.py PROJ-123',
  agentId: 'tech-pm',
});

assert.strictEqual(jiraItem.ticketKey, 'PROJ-123');
assert.strictEqual(jiraItem.sourceType, 'jira');
assert.strictEqual(testBus.jiraConfluenceItems.length, 1);
console.log('  ✅ Test 1 Passed: Jira ticket recorded cleanly.');

// Test 2: Deduplication on identical key
console.log('\n▶ Test 2: Verifying deduplication on update...');
testBus.recordJiraConfluenceItem({
  sourceType: 'jira',
  ticketKey: 'PROJ-123',
  title: 'Jira Ticket PROJ-123: Updated Title',
  summary: 'Updated summary details',
});
assert.strictEqual(testBus.jiraConfluenceItems.length, 1);
assert.strictEqual(testBus.jiraConfluenceItems[0].title, 'Jira Ticket PROJ-123: Updated Title');
console.log('  ✅ Test 2 Passed: Existing item updated without duplicate creation.');

// Test 3: Record Confluence Page
console.log('\n▶ Test 3: Recording Confluence documentation lookup...');
const confItem = testBus.recordJiraConfluenceItem({
  sourceType: 'confluence',
  pageId: '123456',
  url: 'https://confluence.example.com/pages/viewpage.action?pageId=123456',
  title: 'Architecture Specification: Board Export',
  summary: 'Detailed architecture diagrams and REST contract',
  command: 'python3 scripts/read_confluence.py 123456',
  agentId: 'tech-pm',
});

assert.strictEqual(confItem.pageId, '123456');
assert.strictEqual(testBus.jiraConfluenceItems.length, 2);
console.log('  ✅ Test 3 Passed: Confluence doc recorded.');

// Test 4: Verify getStateSnapshot includes jiraConfluenceItems
console.log('\n▶ Test 4: Verifying getStateSnapshot() payload...');
const snapshot = testBus.getStateSnapshot();
assert.ok(Array.isArray(snapshot.jiraConfluenceItems));
assert.strictEqual(snapshot.jiraConfluenceItems.length, 2);
assert.strictEqual(snapshot.jiraConfluenceItems[0].pageId, '123456');
assert.strictEqual(snapshot.jiraConfluenceItems[1].ticketKey, 'PROJ-123');
console.log('  ✅ Test 4 Passed: getStateSnapshot exposes jiraConfluenceItems.');

// Test 5: Verify side effects from emitEvent('jira_confluence_lookup')
console.log('\n▶ Test 5: Emitting jira_confluence_lookup event...');
const pmAgent = Array.from(testBus.agents.values()).find((a) => a.id === 'tech-pm' || a.id === 'project-manager') || Array.from(testBus.agents.values())[0];
const emittedEvt = testBus.emitEvent({
  agentId: pmAgent.id,
  type: 'jira_confluence_lookup',
  payload: {
    sourceType: 'jira',
    ticketKey: 'PROJ-999',
    title: 'Ticket PROJ-999',
    details: 'Testing side effects',
    command: 'python3 scripts/read_jira.py PROJ-999',
  },
});

assert.strictEqual(emittedEvt.type, 'jira_confluence_lookup');
assert.strictEqual(testBus.jiraConfluenceItems.length, 3);
assert.strictEqual(pmAgent.status, 'working');
assert.ok(pmAgent.activityMessage.includes('PROJ-999'));
console.log('  ✅ Test 5 Passed: Event side effects update PM status and activity message.');

// Test 6: Verify clearState resets jiraConfluenceItems
console.log('\n▶ Test 6: Verifying clearState reset...');
testBus.clearState();
assert.strictEqual(testBus.jiraConfluenceItems.length, 0);
console.log('  ✅ Test 6 Passed: State reset successfully clears tickets and documentation.');

// Test 7: End-to-End Watcher Ingestion Validation via parseTranscriptStep
console.log("\n▶ Test 7: Verifying parseTranscriptStep watcher ingestion...");
const { parseTranscriptStep, conversationProjectMatch } = require("../server/watchers");
const { eventBus } = require("../server/eventBus");

const testConvId = "test-conv-jira-conf";
conversationProjectMatch.set(testConvId, true);

eventBus.clearState();

// 7a: run_command executing read_jira.py script
parseTranscriptStep({
  type: "TOOL_EXECUTION",
  tool_calls: [{
    name: "run_command",
    args: { CommandLine: "python3 scripts/read_jira.py PROJ-123", Cwd: "" },
  }],
}, testConvId);

const pmAgentResolved = Array.from(eventBus.agents.values()).find((a) => a.id === "tech-pm" || a.id === "project-manager") || Array.from(eventBus.agents.values())[0];
const jiraItemRecorded = eventBus.jiraConfluenceItems.find((i) => i.ticketKey === "PROJ-123");
assert.ok(jiraItemRecorded, "Expected PROJ-123 to be recorded in eventBus.jiraConfluenceItems");
assert.strictEqual(jiraItemRecorded.sourceType, "jira");
assert.strictEqual(jiraItemRecorded.agentId, pmAgentResolved.id);

// 7b: run_command executing read_confluence.py script
parseTranscriptStep({
  type: "TOOL_EXECUTION",
  tool_calls: [{
    name: "run_command",
    args: { CommandLine: "python3 scripts/read_confluence.py 123456", Cwd: "" },
  }],
}, testConvId);

const confItemRecorded = eventBus.jiraConfluenceItems.find((i) => i.pageId === "123456");
assert.ok(confItemRecorded, "Expected Confluence page 123456 to be recorded");
assert.strictEqual(confItemRecorded.sourceType, "confluence");
assert.strictEqual(confItemRecorded.agentId, pmAgentResolved.id);

// 7c: read_url_content fetching a Jira browse URL
parseTranscriptStep({
  type: "TOOL_EXECUTION",
  tool_calls: [{
    name: "read_url_content",
    args: { Url: "https://jira.example.com/browse/PROJ-333" },
  }],
}, testConvId);

const jiraUrlItem = eventBus.jiraConfluenceItems.find((i) => i.ticketKey === "PROJ-333");
assert.ok(jiraUrlItem, "Expected PROJ-333 to be recorded via URL ingestion");
assert.strictEqual(jiraUrlItem.sourceType, "jira");
console.log("  ✅ Test 7 Passed: End-to-end watcher ingestion detects scripts and URLs and routes to PM workstation.");


console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🎉 ALL JIRA & CONFLUENCE TELEMETRY TESTS PASSED (100%)!');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
