/**
 * Universal AI Agent Registry Test Suite
 *
 * Verifies frontmatter parser, canonical registry engine, validator,
 * provider adapters (OpenCode, Claude, Codex, Gemini), doctor, and migration.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { parseYaml, stringifyYaml, parseFrontmatter, stringifyFrontmatter } = require('../server/registry/frontmatterParser');
const { loadRegistry, hasCanonicalRegistry, saveRegistry } = require('../server/registry/canonicalRegistry');
const { validateRegistry, findDelegationCycles } = require('../server/registry/validator');
const { getAllAdapters, getAdapter, syncAll, cleanAll } = require('../server/adapters');
const { runDoctor } = require('../server/registry/doctor');
const { parseAndRegisterAgents } = require('../server/agentRuntimeRegistry');

const PROJECT_ROOT = path.resolve(__dirname, '..');

async function runTests() {
  console.log('🧪 Starting Universal AI Agent Registry Test Suite...\n');

  // Test 1: Frontmatter & YAML Parser
  console.log('▶ Test 1: Frontmatter & YAML Parser...');
  const sampleYaml = `
version: "2.0.0"
number_val: 42
bool_true: true
bool_false: false
null_val: null
quoted_str: "hello world"
items:
  - one
  - two
  - three
nested:
  keyA: valA
  keyB:
    inner: 100
`;
  const parsed = parseYaml(sampleYaml);
  assert.strictEqual(parsed.version, '2.0.0');
  assert.strictEqual(parsed.number_val, 42);
  assert.strictEqual(parsed.bool_true, true);
  assert.strictEqual(parsed.bool_false, false);
  assert.strictEqual(parsed.null_val, null);
  assert.strictEqual(parsed.quoted_str, 'hello world');
  assert.deepStrictEqual(parsed.items, ['one', 'two', 'three']);
  assert.strictEqual(parsed.nested.keyA, 'valA');
  assert.strictEqual(parsed.nested.keyB.inner, 100);

  const serializedYaml = stringifyYaml(parsed);
  const reParsed = parseYaml(serializedYaml);
  assert.strictEqual(reParsed.version, '2.0.0');
  assert.strictEqual(reParsed.nested.keyB.inner, 100);

  // Frontmatter parsing
  const doc = `---
id: "test-agent"
role: "Tester"
allowed_tools:
  - "view_file"
  - "run_command"
---

# Agent Prompt
This is the instructions body.
`;
  const fm = parseFrontmatter(doc);
  assert.strictEqual(fm.data.id, 'test-agent');
  assert.strictEqual(fm.data.role, 'Tester');
  assert.deepStrictEqual(fm.data.allowed_tools, ['view_file', 'run_command']);
  assert.ok(fm.body.includes('# Agent Prompt'));

  const stringifiedFm = stringifyFrontmatter(fm.data, fm.body);
  const reParsedFm = parseFrontmatter(stringifiedFm);
  assert.strictEqual(reParsedFm.data.id, 'test-agent');
  assert.ok(reParsedFm.body.includes('This is the instructions body.'));
  console.log('  ✅ Frontmatter & YAML parser passed round-trip assertions.');

  // Test 2: Canonical Registry Loading & Discovery
  console.log('\n▶ Test 2: Canonical Registry Loading...');
  assert.strictEqual(hasCanonicalRegistry(PROJECT_ROOT), true, 'Canonical registry should exist');
  const registry = loadRegistry(PROJECT_ROOT);
  assert.ok(registry !== null, 'Registry should load successfully');
  assert.strictEqual(registry.orchestrator, 'tech-pm');
  const agentIds = registry.agents.map((a) => a.id);
  assert.ok(agentIds.includes('tech-pm'));
  assert.strictEqual(registry.agents.length, 3);

  const pm = registry.agents.find((a) => a.id === 'tech-pm');
  assert.strictEqual(pm.is_primary, true);
  // Assert 6-category attributes on loaded agent
  assert.ok(pm.id && pm.name && pm.description, '1. Identity attributes verified');
  assert.ok(pm.role, '2. Behavior attributes verified');
  assert.deepStrictEqual(pm.tools, pm.allowed_tools, '3. Capabilities tools and allowed_tools harmonized');
  assert.ok(pm.tools.includes('invoke_subagent'));
  assert.ok(pm.inputContract !== undefined && pm.outputContract !== undefined, '4. Execution contracts verified');
  assert.ok(Array.isArray(pm.permissions), '5. Governance permissions verified');
  assert.ok(Array.isArray(pm.prohibited_actions), '5. Governance prohibited actions verified');
  assert.strictEqual(pm.reportsTo, 'user', '6. Coordination reportsTo verified for primary');
  assert.deepStrictEqual(pm.handoffTo, pm.delegation_targets, '6. Coordination handoffTo and delegation_targets harmonized');
  assert.ok(pm.handoffTo.length > 0);

  const leadId = pm.handoffTo[0];
  const lead = registry.agents.find((a) => a.id === leadId);
  assert.ok(lead, `Lead agent ${leadId} should exist`);
  assert.strictEqual(lead.reportsTo, 'tech-pm', 'Coordination reportsTo verified for subagent');
  assert.ok(lead.handoffTo.length > 0, 'Lead should have delegation targets');
  assert.ok(pm.skillIds.length > 0);
  console.log('  ✅ Canonical Registry successfully loaded all agents, skills, and orchestrator with 6-category specification.');

  // Test 3: Validator & Cycle Detection
  console.log('\n▶ Test 3: Validator & Cycle Detection...');
  const valResult = validateRegistry(registry, PROJECT_ROOT);
  assert.strictEqual(valResult.valid, true, `Validation failed with errors: ${valResult.errors.join(', ')}`);
  assert.strictEqual(valResult.stats.agentsCount, registry.agents.length);
  assert.ok(valResult.stats.skillsCount >= 10);

  // Test invalid agent id detection
  const badRegistry = {
    orchestrator: 'agent1',
    agents: [
      { id: 'INVALID_ID_WITH_UPPER', allowed_tools: ['view_file'] },
      { id: 'agent1', allowed_tools: ['view_file'], delegation_targets: ['ghost-agent'] },
    ],
  };
  const badVal = validateRegistry(badRegistry, PROJECT_ROOT);
  assert.strictEqual(badVal.valid, false);
  assert.ok(badVal.errors.some((e) => e.includes('does not conform to kebab-case')));
  assert.ok(badVal.errors.some((e) => e.includes('ghost-agent')));

  // Test reportsTo validation (non-existent and self-reporting)
  const badReportsReg = {
    orchestrator: 'lead1',
    agents: [
      { id: 'lead1', role: 'Lead', tools: ['view_file'], reportsTo: 'lead1' },
      { id: 'dev1', role: 'Dev', tools: ['view_file'], reportsTo: 'ghost-lead' },
    ],
  };
  const badReportsVal = validateRegistry(badReportsReg, PROJECT_ROOT);
  assert.strictEqual(badReportsVal.valid, false);
  assert.ok(badReportsVal.errors.some((e) => e.includes('cannot report to itself')));
  assert.ok(badReportsVal.errors.some((e) => e.includes('ghost-lead')));

  // Test cycle detection with handoffTo alias
  const cycleAgents = [
    { id: 'a', handoffTo: ['b'] },
    { id: 'b', handoffTo: ['c'] },
    { id: 'c', handoffTo: ['a'] },
  ];
  const cycles = findDelegationCycles(cycleAgents);
  assert.ok(cycles.length > 0, 'Should detect cycle via handoffTo');
  console.log('  ✅ Validator correctly enforces 6-category schemas and detects cyclic deadlocks.');

  // Test 4: Provider Adapters Generation & Verification
  console.log('\n▶ Test 4: Provider Adapters (OpenCode, Claude, Codex, Gemini)...');
  const adapters = getAllAdapters();
  assert.strictEqual(adapters.length, 4);

  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'universal-registry-test-'));
  try {
    const syncResult = await syncAll(registry, sandboxDir, { framework: 'all' });
    assert.ok(syncResult.totalFilesWritten >= 9, 'Should have written at least 9 provider target files');

    // Verify target files exist in sandbox
    assert.ok(fs.existsSync(path.join(sandboxDir, 'AGENTS.md')));
    assert.ok(fs.existsSync(path.join(sandboxDir, '.agents', 'rules', 'team-orchestration.md')));
    assert.ok(fs.existsSync(path.join(sandboxDir, '.agents', 'runtime-manifest.json')));
    assert.ok(fs.existsSync(path.join(sandboxDir, '.agents', 'agents.json')));
    assert.ok(fs.existsSync(path.join(sandboxDir, 'CLAUDE.md')));
    assert.ok(fs.existsSync(path.join(sandboxDir, '.claude', 'config.json')));
    assert.ok(fs.existsSync(path.join(sandboxDir, '.codex', 'system-prompts.md')));
    assert.ok(fs.existsSync(path.join(sandboxDir, '.codex', 'instructions.md')));
    assert.ok(fs.existsSync(path.join(sandboxDir, 'GEMINI.md')));

    // Verify AGENTS.md content
    const agentsMd = fs.readFileSync(path.join(sandboxDir, 'AGENTS.md'), 'utf8');
    assert.ok(agentsMd.includes('ALWAYS INVOKE `tech-pm` FIRST'));
    assert.ok(agentsMd.includes('flowchart TD'));
    assert.ok(agentsMd.includes('tech-pm'));

    // Verify CLAUDE.md content
    const claudeMd = fs.readFileSync(path.join(sandboxDir, 'CLAUDE.md'), 'utf8');
    assert.ok(claudeMd.includes('Route every software request to `tech-pm`'));
    assert.ok(claudeMd.includes('## Team'));

    // Verify GEMINI.md content
    const geminiMd = fs.readFileSync(path.join(sandboxDir, 'GEMINI.md'), 'utf8');
    assert.ok(geminiMd.includes('Route every software request to `tech-pm`'));
    assert.ok(geminiMd.includes('## Delegation'));
    console.log('  ✅ All provider adapters compiled matching target files.');
  } finally {
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  }

  // Test 5: Health Doctor
  console.log('\n▶ Test 5: Doctor Diagnostics Engine...');
  const docReport = await runDoctor(PROJECT_ROOT);
  assert.strictEqual(docReport.passed, true);
  assert.ok(docReport.checks.length >= 5);
  console.log('  ✅ Doctor diagnostics engine verified project health.');

  // Test 6: AgentRuntimeRegistry SSOT Integration
  console.log('\n▶ Test 6: AgentRuntimeRegistry Canonical Integration...');
  const runtimeReg = parseAndRegisterAgents(PROJECT_ROOT);
  assert.strictEqual(runtimeReg.canonical, true, 'Runtime registry should detect and load canonical SSOT');
  assert.strictEqual(runtimeReg.orchestratorAgentId, 'tech-pm');
  assert.strictEqual(runtimeReg.totalAgents, 3);
  console.log('  ✅ AgentRuntimeRegistry loads canonical registry seamlessly.');

  console.log('\n🎉 ALL UNIVERSAL AGENT REGISTRY TESTS PASSED SUCCESSFULLY (100%)!\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
