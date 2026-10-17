const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WC = path.join(ROOT, 'bin', 'wc.js');
const { count } = require('../src/count');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-cli-'));

function fixture(name, content) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

function runCli(...args) {
  const r = spawnSync(process.execPath, [WC, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test.after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// 1. default output line
test('default mode prints `<lines> <words> <chars> <file>` on one line', () => {
  const file = fixture('notes.txt', 'a b\nc\n');
  const r = runCli(file);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, `2 3 6 ${file}\n`);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout.split('\n').length, 2, 'stdout must be a single line');
});

// 2. --json shape
test('--json prints one line of JSON with exactly lines, words, chars', () => {
  const file = fixture('notes.txt', 'a b\nc\n');
  const r = runCli('--json', file);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout.split('\n').length, 2, 'stdout must be a single line');
  const parsed = JSON.parse(r.stdout);
  assert.deepEqual(parsed, { lines: 2, words: 3, chars: 6 });
  assert.deepEqual(Object.keys(parsed).sort(), ['chars', 'lines', 'words']);
  for (const key of ['lines', 'words', 'chars']) {
    assert.equal(Number.isInteger(parsed[key]), true, `${key} must be an integer`);
  }
});

// 3. flag in both positions
test('--json is accepted before and after the path, with identical output', () => {
  const file = fixture('notes.txt', 'a b\nc\n');
  const before = runCli('--json', file);
  const after = runCli(file, '--json');
  assert.equal(before.status, 0);
  assert.equal(after.status, 0);
  assert.equal(before.stdout, after.stdout);
  assert.equal(before.stdout, '{"lines":2,"words":3,"chars":6}\n');
});

// 4. JSON values equal the default line; chars are characters, not bytes
test('JSON values agree with the default line', () => {
  const file = fixture('notes.txt', 'a b\nc\n');
  const plain = runCli(file);
  const json = runCli('--json', file);
  const [lines, words, chars] = plain.stdout.trim().split(/\s+/).slice(0, 3).map(Number);
  assert.deepEqual({ lines, words, chars }, JSON.parse(json.stdout));
});

test('chars counts characters of the decoded text, not bytes', () => {
  const file = fixture('cafe.txt', 'café\n');
  assert.equal(Buffer.byteLength(fs.readFileSync(file)), 6, 'fixture is 6 bytes');
  const plain = runCli(file);
  assert.equal(plain.status, 0);
  assert.equal(plain.stdout, `1 1 5 ${file}\n`);
  const json = runCli('--json', file);
  assert.deepEqual(JSON.parse(json.stdout), { lines: 1, words: 1, chars: 5 });
});

// 5. empty file
test('an empty file is 0 0 0 in both modes', () => {
  const file = fixture('empty.txt', '');
  const plain = runCli(file);
  assert.equal(plain.status, 0);
  assert.equal(plain.stdout, `0 0 0 ${file}\n`);
  assert.equal(plain.stderr, '');
  const json = runCli('--json', file);
  assert.equal(json.status, 0);
  assert.deepEqual(JSON.parse(json.stdout), { lines: 0, words: 0, chars: 0 });
});

// 6. trailing newline adds no phantom line
test('a trailing newline does not add a line', () => {
  const withNewline = fixture('trailing.txt', 'a b\nc\n');
  const withoutNewline = fixture('no-trailing.txt', 'a b\nc');
  assert.equal(runCli(withNewline).stdout, `2 3 6 ${withNewline}\n`);
  assert.equal(runCli(withoutNewline).stdout, `2 3 5 ${withoutNewline}\n`);
  assert.deepEqual(JSON.parse(runCli('--json', withNewline).stdout), { lines: 2, words: 3, chars: 6 });
  assert.deepEqual(JSON.parse(runCli('--json', withoutNewline).stdout), { lines: 2, words: 3, chars: 5 });
  const onlyNewline = fixture('newline.txt', '\n');
  assert.deepEqual(JSON.parse(runCli('--json', onlyNewline).stdout), { lines: 1, words: 0, chars: 1 });
});

// 7. missing file argument
test('a missing file argument fails with usage on stderr and empty stdout', () => {
  for (const args of [[], ['--json']]) {
    const r = runCli(...args);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /usage/);
  }
  const r = runCli();
  assert.equal(r.stderr, 'usage: wc [--json] <file>\n');
});

// 8. unreadable path
test('a nonexistent path fails on stderr with empty stdout', () => {
  const missing = path.join(dir, 'does-not-exist.txt');
  for (const args of [[missing], ['--json', missing], [missing, '--json']]) {
    const r = runCli(...args);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, `wc: cannot read ${missing}: ENOENT: no such file or directory, open '${missing}'\n`);
  }
});

test('an unreadable file fails on stderr with empty stdout', (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    t.skip('running as root: a chmod 000 file stays readable');
    return;
  }
  const file = fixture('unreadable.txt', 'a b\nc\n');
  fs.chmodSync(file, 0o000);
  const r = runCli('--json', file);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, new RegExp(`^wc: cannot read ${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: `));
  fs.chmodSync(file, 0o600);
});

// 9. counting logic unit cases
test('count() handles empty, trailing-newline and multi-byte text', () => {
  assert.deepEqual(count(''), { lines: 0, words: 0, chars: 0 });
  assert.deepEqual(count('a b\nc\n'), { lines: 2, words: 3, chars: 6 });
  assert.deepEqual(count('👍\n'), { lines: 1, words: 1, chars: 3 });
  assert.deepEqual(count('  a  b  '), { lines: 1, words: 2, chars: 8 });
});
