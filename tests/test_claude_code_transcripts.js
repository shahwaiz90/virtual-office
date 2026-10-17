const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-claude-transcripts-'));
const claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'test-claude-home-'));
process.env.CLAUDE_CONFIG_DIR = claudeHome;

const { setProjectRoot } = require('../server/agentDiscovery');
const {
  claudeProjectSlug,
  resolveClaudeProjectDir,
  listClaudeTranscripts,
  toTranscriptSteps,
} = require('../server/claudeTranscripts');
const { handleClaudeEntry, isPathInProject } = require('../server/watchers');
const { eventBus } = require('../server/eventBus');

console.log('🧪 Starting Claude Code Transcript Ingestion Test Suite...\n');

try {
  setProjectRoot(testRoot);
  eventBus.clearState();
  eventBus.clearedAt = 0;

  // Test 1: project slug matches Claude Code's ~/.claude/projects naming
  console.log('▶ Test 1: Verifying project slug and transcript discovery...');
  assert.strictEqual(claudeProjectSlug('/Users/me/Desktop/Virtual Office'), '-Users-me-Desktop-Virtual-Office');
  const projectDir = resolveClaudeProjectDir(testRoot);
  fs.mkdirSync(path.join(projectDir, 'session-a', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'session-a.jsonl'), '');
  fs.writeFileSync(path.join(projectDir, 'session-a', 'subagents', 'agent-1.jsonl'), '');
  const found = listClaudeTranscripts(testRoot).map((t) => path.basename(t.filePath)).sort();
  assert.deepStrictEqual(found, ['agent-1.jsonl', 'session-a.jsonl']);
  console.log('  ✅ Test 1 Passed: Session and subagent transcripts discovered.\n');

  // Test 2: entry conversion
  console.log('▶ Test 2: Verifying JSONL entry conversion...');
  const prompt = {
    type: 'user',
    uuid: 'u-1',
    origin: { kind: 'human' },
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: 'Add a logout button to the header<system-reminder>ignore me</system-reminder>' },
  };
  const promptSteps = toTranscriptSteps(prompt, isPathInProject);
  assert.strictEqual(promptSteps.length, 1);
  assert.strictEqual(promptSteps[0].type, 'USER_INPUT');
  assert.strictEqual(promptSteps[0].content, 'Add a logout button to the header');

  const toolResult = {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] },
  };
  assert.deepStrictEqual(toTranscriptSteps(toolResult, isPathInProject), []);

  const edit = {
    type: 'assistant',
    cwd: testRoot,
    timestamp: new Date().toISOString(),
    message: {
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', name: 'Edit', input: { file_path: path.join(testRoot, 'src/Header.tsx'), old_string: 'a', new_string: 'b' } },
        { type: 'tool_use', name: 'Read', input: { file_path: path.join(os.homedir(), 'elsewhere.txt') } },
        { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
      ],
    },
  };
  const editSteps = toTranscriptSteps(edit, isPathInProject);
  assert.strictEqual(editSteps.length, 1);
  assert.deepStrictEqual(editSteps[0].tool_calls.map((c) => c.name), ['replace_file_content', 'run_command']);
  console.log('  ✅ Test 2 Passed: Prompts, tool calls and out-of-project paths mapped correctly.\n');

  // Test 3: a prompt becomes a Kanban card that completes when the turn ends
  console.log('▶ Test 3: Verifying prompt card lifecycle...');
  const state = { convId: 'claude-session-a', promptTaskId: null };
  handleClaudeEntry(prompt, state);
  const card = eventBus.tasks.get(state.promptTaskId);
  assert.ok(card, 'Expected a Kanban card for the prompt');
  assert.strictEqual(card.title, 'Add a logout button to the header');
  assert.strictEqual(card.column, 'in_progress');

  handleClaudeEntry(edit, state);
  assert.ok(
    eventBus.events.some((e) => e.type === 'file_modified' && String(e.payload?.file || e.file || '').includes('Header.tsx')),
    'Expected the edit to appear in the activity log'
  );

  const cardId = state.promptTaskId;
  handleClaudeEntry(
    { type: 'assistant', timestamp: new Date().toISOString(), message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Added the button.' }] } },
    state
  );
  assert.strictEqual(eventBus.tasks.get(cardId).column, 'done');

  // Replaying the same prompt must not create a duplicate card
  handleClaudeEntry(prompt, { convId: 'claude-session-a', promptTaskId: null });
  assert.strictEqual(Array.from(eventBus.tasks.keys()).filter((id) => id === cardId).length, 1);
  assert.strictEqual(eventBus.tasks.get(cardId).column, 'done');
  console.log('  ✅ Test 3 Passed: Prompt card created, linked to edits, and completed at turn end.\n');

  // Test 3b: keyword guesses and file edits never complete or reopen cards in a Claude session
  console.log('▶ Test 3b: Verifying card state only follows real turn boundaries...');
  const state2 = { convId: 'claude-session-b', promptTaskId: null };
  const prompt2 = { ...prompt, uuid: 'u-2', message: { role: 'user', content: 'Recolor the Deliverables button' } };
  handleClaudeEntry(prompt2, state2);
  const card2 = state2.promptTaskId;
  const card2Obj = eventBus.tasks.get(card2);
  handleClaudeEntry(
    { type: 'assistant', timestamp: new Date().toISOString(), message: { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Updating the Deliverables button; all tests passed.' }] } },
    state2
  );
  assert.strictEqual(card2Obj.column, 'in_progress', 'Mid-turn text must not complete the card');

  const testEdit = {
    type: 'assistant',
    cwd: testRoot,
    timestamp: new Date().toISOString(),
    message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: path.join(testRoot, 'tests/a.test.js'), old_string: 'a', new_string: 'b' } }] },
  };
  // A follow-up prompt in the same conversation goes on that conversation's card, not a new card
  const cardsBefore = eventBus.tasks.size;
  const prompt3 = { ...prompt, uuid: 'u-3', message: { role: 'user', content: 'Also make it teal' } };
  handleClaudeEntry(prompt3, state2);
  assert.strictEqual(eventBus.tasks.size, cardsBefore, 'A follow-up must not create a card');
  assert.strictEqual(state2.promptTaskId, card2, 'The follow-up continues the conversation card');
  const request = card2Obj.thread.find((m) => m.kind === 'request');
  assert.ok(request && request.text === 'Also make it teal' && request.agentId === 'user', 'The follow-up is on the thread');
  handleClaudeEntry(
    { type: 'assistant', timestamp: new Date().toISOString(), message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] } },
    state2
  );
  assert.strictEqual(card2Obj.column, 'done', 'The turn end closes the card');

  // A follow-up after the card was done reopens it; replaying the same prompt adds nothing
  const prompt4 = { ...prompt, uuid: 'u-4', message: { role: 'user', content: 'One more tweak' } };
  handleClaudeEntry(prompt4, state2);
  assert.strictEqual(card2Obj.column, 'in_progress', 'New work reopens the finished card');
  handleClaudeEntry(prompt4, { convId: 'claude-session-b', promptTaskId: null });
  assert.strictEqual(card2Obj.thread.filter((m) => m.kind === 'request').length, 2, 'A replayed follow-up is not posted twice');
  handleClaudeEntry(
    { type: 'assistant', timestamp: new Date().toISOString(), message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] } },
    state2
  );
  // With every card done, editing a test file must not reopen any of them
  handleClaudeEntry(testEdit, { convId: 'claude-session-b', promptTaskId: null });
  assert.strictEqual(card2Obj.column, 'done', 'Finished card must not be reopened by a test edit');

  // A new prompt never starts a sprint by itself, even when every card is done
  const sprintBefore = eventBus.activeSprintId;
  handleClaudeEntry({ ...prompt, uuid: 'u-5', message: { role: 'user', content: 'A brand new request' } }, { convId: 'claude-session-e', promptTaskId: null });
  assert.strictEqual(eventBus.activeSprintId, sprintBefore, 'No automatic sprint rollover');
  console.log('  ✅ Test 3b Passed: One card per conversation, follow-ups on its thread, no automatic sprints.\n');

  // Test 3c: events the host app injects as user turns are not prompts and never become cards
  console.log('▶ Test 3c: Verifying app-injected events create no cards...');
  const injectedBodies = [
    '<system-reminder>\nThe user started your proposal task_1 as session local_x.\n</system-reminder>\n<side-sessions-event>None of the sessions you started is working now; their notes are above.</side-sessions-event>',
    '<cross-session-message from="local_abc" name="Fix bugs">\nBlocked: which option?\n</cross-session-message>',
    '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>',
    '<ci-monitor-event>CI failed on PR 12</ci-monitor-event>',
  ];
  const sizeBeforeInjected = eventBus.tasks.size;
  injectedBodies.forEach((content, i) => {
    // Real transcripts mark these turnOrigin "sdk" with no origin field
    const injected = { type: 'user', uuid: `inj-${i}`, promptSource: 'sdk', turnOrigin: 'sdk', timestamp: new Date().toISOString(), message: { role: 'user', content } };
    assert.deepStrictEqual(toTranscriptSteps(injected, isPathInProject), [], `Injected event ${i} must not be a prompt`);
    handleClaudeEntry(injected, { convId: 'claude-session-c', promptTaskId: null });
  });
  assert.strictEqual(eventBus.tasks.size, sizeBeforeInjected, 'Injected events must not create cards');
  // A typed prompt with no origin field is still a prompt
  const plainPrompt = { type: 'user', uuid: 'plain-1', timestamp: new Date().toISOString(), message: { role: 'user', content: 'Make the CLI output readable' } };
  assert.strictEqual(toTranscriptSteps(plainPrompt, isPathInProject).length, 1);
  console.log('  ✅ Test 3c Passed: side-sessions, cross-session, task and CI events are ignored.\n');

  // Test 4: no sample data outside demo mode
  console.log('▶ Test 4: Verifying no sample data is seeded outside demo mode...');
  const { EventBus } = require('../server/eventBus');
  const fresh = new EventBus();
  assert.strictEqual(fresh.deliverables.size, 0);
  assert.strictEqual(fresh.communications.length, 0);
  assert.strictEqual(fresh.fileChanges.length, 0);
  for (const r of fresh.roleInvocationMap.values()) {
    assert.strictEqual(r.invocations, 0);
  }
  console.log('  ✅ Test 4 Passed: Fresh state has no sample deliverables, comms, or metrics.\n');

  // Test 5: analytics carry no invented numbers; durations are unknown unless measured
  console.log('▶ Test 5: Verifying analytics record only measured durations...');
  for (const seed of ['initDefaultToolAnalytics', 'initDefaultSkillAnalytics', 'initDefaultRoleAnalytics']) {
    assert.strictEqual(typeof fresh[seed], 'undefined', `${seed} must not exist`);
  }
  fresh.recordToolUsage('web-dev', 'run_command');
  fresh.recordToolUsage('web-dev', 'run_command', 4);
  const toolStat = fresh.toolUsageMap.get('web-dev::run_command');
  assert.deepStrictEqual([toolStat.count, toolStat.measuredCount, toolStat.totalDurationSec], [2, 1, 4]);
  fresh.recordSkillUsage('kanban-handoff', 'web-dev');
  assert.deepStrictEqual([fresh.skillUsageMap.get('kanban-handoff').measuredCount, fresh.skillUsageMap.get('kanban-handoff').totalDurationSec], [0, 0]);
  fresh.recordRoleInvocation('web-dev');
  assert.deepStrictEqual([fresh.roleInvocationMap.get('web-dev').invocations, fresh.roleInvocationMap.get('web-dev').activeTimeSec], [1, 0]);
  console.log('  ✅ Test 5 Passed: No seeded analytics; unmeasured calls add no time.\n');

  // Test 6: token usage per agent, counted once per message although each content block repeats it
  console.log('▶ Test 6: Verifying token usage is captured per agent...');
  eventBus.agents.set('web-dev', { id: 'web-dev', name: 'Web Dev', role: 'Developer', skills: [] });
  const usage = { input_tokens: 2, output_tokens: 16, cache_read_input_tokens: 9383, cache_creation_input_tokens: 4379 };
  const blockEntry = (type) => ({
    type: 'assistant',
    cwd: testRoot,
    timestamp: new Date().toISOString(),
    message: { id: 'msg_1', stop_reason: null, usage, content: [type === 'thinking' ? { type: 'thinking', thinking: '' } : { type: 'tool_use', name: 'Read', input: { file_path: path.join(testRoot, 'a.js') } }] },
  });
  const subState = { convId: 'claude-session-d', promptTaskId: null, agentType: 'web-dev' };
  handleClaudeEntry(blockEntry('thinking'), subState);
  handleClaudeEntry(blockEntry('tool_use'), subState);
  const devTokens = eventBus.tokenUsageMap.get('web-dev');
  assert.ok(devTokens, 'Token usage recorded for the subagent role');
  assert.deepStrictEqual(
    [devTokens.messages, devTokens.inputTokens, devTokens.outputTokens, devTokens.cacheReadTokens, devTokens.cacheCreationTokens],
    [1, 2, 16, 9383, 4379],
    'A message is counted once across its content blocks'
  );
  assert.strictEqual(toTranscriptSteps(blockEntry('tool_use'), isPathInProject)[0].turn.usage.cache_read_input_tokens, 9383, 'Steps keep message usage');
  assert.ok(eventBus.getStateSnapshot().tokenUsageAnalytics.some((t) => t.agentId === 'web-dev'));
  console.log('  ✅ Test 6 Passed: Input and cache tokens surfaced per agent.\n');

  // Test 7: a session started after the portal is read from its first line, so its first prompt becomes a card
  console.log('▶ Test 7: Verifying sessions started after the portal get their card...');
  const { attachTranscriptTail } = require('../server/watchers');
  eventBus.clearedAt = Date.now() - 60000; // the portal started a minute ago
  const writeSession = (name, entries) => {
    const file = path.join(projectDir, `${name}.jsonl`);
    fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    return file;
  };
  const briefEntry = (uuid, at, text) => ({
    type: 'user',
    uuid,
    timestamp: new Date(at).toISOString(),
    message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>Linked sessions now</system-reminder>' }, { type: 'text', text }] },
  });
  // Started after the portal, noticed a few seconds later (as a side session from another session is)
  const newFile = writeSession('session-new', [briefEntry('n-1', Date.now() - 3000, 'Task (from the session that started this one):\nBackground (from the session that started this one):\nVirtual Office is a local portal.\n\nTask:\nMake the portal header mobile-friendly\n\nDone when: tests pass')]);
  // Started before the portal: its old prompt is history
  const oldFile = writeSession('session-old', [briefEntry('o-1', Date.now() - 120000, 'An old request from before the restart')]);
  attachTranscriptTail(newFile, { format: 'claude', convId: 'claude-session-new' });
  attachTranscriptTail(oldFile, { format: 'claude', convId: 'claude-session-old' });
  const cardOf = (conv) => Array.from(eventBus.tasks.values()).find((t) => t.sourceConversation === conv && t.type === 'requirement');
  assert.ok(cardOf('claude-session-new'), 'The first prompt of a new session becomes its card');
  assert.strictEqual(cardOf('claude-session-new').title, 'Make the portal header mobile-friendly');
  assert.ok(!cardOf('claude-session-old'), 'A session from before the portal started is not replayed');
  fs.unwatchFile(newFile);
  fs.unwatchFile(oldFile);
  console.log('  ✅ Test 7 Passed: New sessions are read from their first line.\n');

  console.log('🎉 Claude Code transcript ingestion tests passed!');
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
  fs.rmSync(claudeHome, { recursive: true, force: true });
}
process.exit(0);
