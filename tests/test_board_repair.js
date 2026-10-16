const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolated project root and Claude config so nothing touches the real board or transcripts
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-board-repair-'));
const claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'test-board-repair-home-'));
process.env.CLAUDE_CONFIG_DIR = claudeHome;
const { setProjectRoot } = require('../server/agentDiscovery');
setProjectRoot(testRoot);

const { eventBus } = require('../server/eventBus');
const { syncTasksFromJson, getActiveSprintInfo, toRelativePath } = require('../server/watchers');
const { claudeProjectSlug, listClaudeTranscripts } = require('../server/claudeTranscripts');

console.log('🧪 Starting Board Repair Test Suite...\n');
eventBus.broadcast = () => {};
eventBus.agents.clear();
for (const a of [
  { id: 'tech-pm', name: 'Scrum Master', role: 'Tech Scrum Master' },
  { id: 'web-tech-lead', name: 'Web Lead', role: 'Tech Lead' },
  { id: 'web-dev', name: 'Web Dev', role: 'Developer' },
]) {
  eventBus.agents.set(a.id, { ...a, skills: [], status: 'available', theme: { deskPosition: { x: 0, y: 0 } }, currentPosition: { x: 0, y: 0 } });
}
eventBus.tasks = new Map();
eventBus.clearedAt = 0;

const at = '2026-10-16T20:06:00.000Z';
const card = (key, extra) => ({ id: `TASK-${key}`, key, title: key, assignedTo: 'web-dev', delegatedBy: 'tech-pm', column: 'in_progress', thread: [], createdAt: at, updatedAt: at, ...extra });

try {
  console.log('▶ Test 1: Junk cards are removed and finished requirements close on load...');
  const sprint = getActiveSprintInfo(testRoot);
  const tasksJson = path.join(testRoot, sprint.path, 'tasks.json');
  fs.mkdirSync(path.dirname(tasksJson), { recursive: true });
  const tasks = [
    // The sprint-6 shapes from the audit
    card('WEB-101', { type: 'requirement', assignedTo: 'tech-pm', column: 'testing', thread: [{ id: 'm1', agentId: 'tech-pm', kind: 'decision', text: 'Broken down into WEB-102.', at }] }),
    card('WEB-102', { parentKey: 'WEB-101', assignedTo: 'web-tech-lead', column: 'review', thread: [{ id: 'm2', agentId: 'web-tech-lead', kind: 'result', text: 'Moved in_progress → review. Result: approved.', at }] }),
    card('WEB-103', { parentKey: 'WEB-102', delegatedBy: 'web-tech-lead', column: 'done', progress: 100 }),
    card('WEB-211615312', { assignedTo: 'web-tech-lead', brief: 'Your task: WEB-103. Read it with curl.', thread: [{ id: 'm3', agentId: 'tech-pm', kind: 'handoff', text: 'Your task: WEB-103.', at }] }),
    card('CC-1813987662', { type: 'requirement', assignedTo: 'tech-pm', column: 'done', description: '<side-sessions-event>None of the sessions you started is working now.</side-sessions-event>' }),
    card('CC-1675941315', { type: 'requirement', assignedTo: 'tech-pm', column: 'done', description: '<cross-session-message from="local_x">Blocked</cross-session-message>' }),
    card('CC-2127099808', { type: 'requirement', assignedTo: 'tech-pm', column: 'done', description: 'can the cli in the terminal grid be cleaner?' }),
    // A requirement its owner explicitly moved to review stays with the owner
    card('WEB-500', { type: 'requirement', assignedTo: 'tech-pm', column: 'review', thread: [{ id: 'm4', agentId: 'tech-pm', kind: 'result', text: 'Moved in_progress → review. Result: awaiting browser check.', at }] }),
    card('WEB-501', { parentKey: 'WEB-500', column: 'done', progress: 100 }),
  ];
  fs.writeFileSync(tasksJson, JSON.stringify({ sprintId: sprint.id, tasks }, null, 2));
  syncTasksFromJson(tasksJson, { force: true });

  const keys = Array.from(eventBus.tasks.values()).map((t) => t.key).sort();
  assert.deepStrictEqual(keys, ['CC-2127099808', 'WEB-101', 'WEB-102', 'WEB-103', 'WEB-500', 'WEB-501'], 'Injected-message and orphan dispatch cards are removed; real prompt cards stay');
  assert.strictEqual(eventBus.tasks.get('TASK-WEB-102').column, 'done', 'Reviewed lead card with its sub-task done closes');
  assert.strictEqual(eventBus.tasks.get('TASK-WEB-101').column, 'done', 'Requirement closes when its sub-tasks are done');
  assert.strictEqual(eventBus.tasks.get('TASK-WEB-500').column, 'review', 'A requirement the owner moved to review is not closed for them');
  // The repair is written back so the next load starts clean
  const saved = JSON.parse(fs.readFileSync(tasksJson, 'utf8')).tasks;
  assert.ok(!saved.some((t) => t.key === 'WEB-211615312'), 'Repair is persisted');
  console.log('  ✅ Test 1 Passed.\n');

  console.log('▶ Test 2: Transcripts of the project\'s git worktrees are read too...');
  const projects = path.join(claudeHome, 'projects');
  const slug = claudeProjectSlug(testRoot);
  const worktreeDir = path.join(projects, `${slug}--claude-worktrees-brave-otter-1`);
  fs.mkdirSync(path.join(projects, slug), { recursive: true });
  fs.mkdirSync(path.join(worktreeDir, 'sess-w', 'subagents'), { recursive: true });
  fs.mkdirSync(path.join(projects, `${slug}-other-project`), { recursive: true });
  fs.writeFileSync(path.join(projects, slug, 'sess-main.jsonl'), '');
  fs.writeFileSync(path.join(worktreeDir, 'sess-w.jsonl'), '');
  fs.writeFileSync(path.join(worktreeDir, 'sess-w', 'subagents', 'agent-1.jsonl'), '');
  fs.writeFileSync(path.join(projects, `${slug}-other-project`, 'foreign.jsonl'), '');
  const found = listClaudeTranscripts(testRoot).map((t) => path.basename(t.filePath)).sort();
  assert.deepStrictEqual(found, ['agent-1.jsonl', 'sess-main.jsonl', 'sess-w.jsonl'], 'Main and worktree sessions, not other projects');
  assert.strictEqual(toRelativePath(path.join(testRoot, '.claude', 'worktrees', 'brave-otter-1', 'src', 'App.tsx')), 'src/App.tsx', 'Worktree files map to project paths');
  console.log('  ✅ Test 2 Passed.\n');

  console.log('🎉 ALL BOARD REPAIR TESTS PASSED!');
} catch (e) {
  console.error('❌ Board repair test failed:', e);
  process.exitCode = 1;
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
  fs.rmSync(claudeHome, { recursive: true, force: true });
  setTimeout(() => process.exit(process.exitCode || 0), 50);
}
