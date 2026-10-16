/**
 * Universal AI Agent Registry — End-to-End & Regression Test Suite
 * Task: REG-104 (QA Specialist Automation & Verification)
 *
 * Comprehensive E2E test coverage for:
 * 1. Frontmatter parser & YAML edge cases (empty strings, comments, multiline, booleans, scalars)
 * 2. Schema validator constraint enforcement & failure detection (duplicates, ghost orchestrator, dangling targets, cycles, invalid IDs)
 * 3. CLI execution for all subcommands (validate, sync, list, skills, doctor, clean, --json, --dry-run, --framework)
 * 4. Content and structural integrity of all multi-provider artifacts (OpenCode, Claude, Codex, Gemini)
 * 5. Clean & restore idempotency and non-destructive isolation
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const {
  parseYaml,
  stringifyYaml,
  parseFrontmatter,
  stringifyFrontmatter,
} = require('../server/registry/frontmatterParser');
const {
  loadRegistry,
  hasCanonicalRegistry,
  saveRegistry,
} = require('../server/registry/canonicalRegistry');
const {
  validateRegistry,
  findDelegationCycles,
} = require('../server/registry/validator');
const {
  getAllAdapters,
  getAdapter,
  syncAll,
  cleanAll,
} = require('../server/adapters');
const { runDoctor, formatDoctorReport } = require('../server/registry/doctor');
const { parseAndRegisterAgents } = require('../server/agentRuntimeRegistry');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CLI_PATH = path.join(PROJECT_ROOT, 'bin', 'agents.js');

let totalAssertions = 0;
let passedAssertions = 0;

function assertTest(condition, message) {
  totalAssertions++;
  assert.ok(condition, message);
  passedAssertions++;
}

function assertStrictEqualTest(actual, expected, message) {
  totalAssertions++;
  assert.strictEqual(actual, expected, message);
  passedAssertions++;
}

function assertDeepStrictEqualTest(actual, expected, message) {
  totalAssertions++;
  assert.deepStrictEqual(actual, expected, message);
  passedAssertions++;
}

async function runE2ESuite() {
  const startTime = Date.now();
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 Universal AI Agent Registry — E2E & Regression Test Suite');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // =========================================================================
  // SUITE 1: Frontmatter & YAML Parser Edge Cases
  // =========================================================================
  console.log('▶ Suite 1: Frontmatter & YAML Parser Edge Cases...');

  // 1.1 Empty input & whitespace
  const emptyFm = parseFrontmatter('');
  assertDeepStrictEqualTest(emptyFm.data, {}, 'Empty string frontmatter data should be empty object');
  assertStrictEqualTest(emptyFm.body, '', 'Empty string frontmatter body should be empty string');

  const whitespaceFm = parseFrontmatter('   \n\n   \t  \n');
  assertDeepStrictEqualTest(whitespaceFm.data, {}, 'Whitespace-only frontmatter data should be empty object');
  assertStrictEqualTest(whitespaceFm.body, '', 'Whitespace-only frontmatter body should be empty string');

  // 1.2 Markdown with no frontmatter delimiters
  const noDelimDoc = '# Title\nJust a regular markdown file with no YAML frontmatter.\n- item 1\n- item 2';
  const parsedNoDelim = parseFrontmatter(noDelimDoc);
  assertDeepStrictEqualTest(parsedNoDelim.data, {}, 'No-delim markdown data should be empty object');
  assertStrictEqualTest(parsedNoDelim.body, noDelimDoc, 'No-delim markdown body should be original text');

  // 1.3 Frontmatter with missing closing delimiter
  const unclosedDoc = '---\nid: broken-agent\nname: Broken Agent\n# Missing closing delimiter';
  const parsedUnclosed = parseFrontmatter(unclosedDoc);
  assertDeepStrictEqualTest(parsedUnclosed.data, {}, 'Unclosed frontmatter delimiter should yield empty data');
  assertStrictEqualTest(parsedUnclosed.body, unclosedDoc, 'Unclosed frontmatter delimiter preserves raw document');

  // 1.4 Complex scalars, booleans, nulls, numbers, and quoting
  const complexYaml = `
str_unquoted: standard-string-123
str_single: 'single-quoted string with spaces'
str_double: "double-quoted string with \\"escaped\\" quotes"
str_single_escaped: 'it''s a nice day'
num_int: -42
num_float: 3.14159
num_zero: 0
bool_t1: true
bool_t2: True
bool_t3: TRUE
bool_f1: false
bool_f2: False
bool_f3: FALSE
val_null1: null
val_null2: NULL
val_null3: ~
val_empty: 
inline_array: ["alpha", "beta", "gamma", 100, true]
inline_object: { key1: "value1", key2: 200, key3: false }
`;
  const parsedComplex = parseYaml(complexYaml);
  assertStrictEqualTest(parsedComplex.str_unquoted, 'standard-string-123', 'Unquoted string scalar');
  assertStrictEqualTest(parsedComplex.str_single, 'single-quoted string with spaces', 'Single quoted string');
  assertStrictEqualTest(parsedComplex.str_double, 'double-quoted string with "escaped" quotes', 'Double quoted with escapes');
  assertStrictEqualTest(parsedComplex.str_single_escaped, "it's a nice day", 'Single quoted with escaped quote');
  assertStrictEqualTest(parsedComplex.num_int, -42, 'Negative integer parsed');
  assertStrictEqualTest(parsedComplex.num_float, 3.14159, 'Float parsed');
  assertStrictEqualTest(parsedComplex.num_zero, 0, 'Zero parsed');
  assertStrictEqualTest(parsedComplex.bool_t1, true, 'bool true');
  assertStrictEqualTest(parsedComplex.bool_t2, true, 'bool True');
  assertStrictEqualTest(parsedComplex.bool_t3, true, 'bool TRUE');
  assertStrictEqualTest(parsedComplex.bool_f1, false, 'bool false');
  assertStrictEqualTest(parsedComplex.bool_f2, false, 'bool False');
  assertStrictEqualTest(parsedComplex.bool_f3, false, 'bool FALSE');
  assertStrictEqualTest(parsedComplex.val_null1, null, 'null1 parsed');
  assertStrictEqualTest(parsedComplex.val_null2, null, 'null2 parsed');
  assertStrictEqualTest(parsedComplex.val_null3, null, 'null3 parsed');
  assertStrictEqualTest(parsedComplex.val_empty, null, 'empty val is null');
  assertDeepStrictEqualTest(parsedComplex.inline_array, ['alpha', 'beta', 'gamma', 100, true], 'Inline array parsing');
  assertStrictEqualTest(parsedComplex.inline_object.key1, 'value1', 'Inline object key1');
  assertStrictEqualTest(parsedComplex.inline_object.key2, 200, 'Inline object key2');
  assertStrictEqualTest(parsedComplex.inline_object.key3, false, 'Inline object key3');

  // 1.5 Comments handling (inline, standalone, and inside quotes)
  const commentedYaml = `
# Header Comment
app_id: "agent-engine" # trailing comment
description: "Has a # symbol inside quotes that should NOT be stripped" # comment at end
# Full line comment
active: true # comment after bool
`;
  const parsedComments = parseYaml(commentedYaml);
  assertStrictEqualTest(parsedComments.app_id, 'agent-engine', 'Trailing comment stripped from value');
  assertStrictEqualTest(parsedComments.description, 'Has a # symbol inside quotes that should NOT be stripped', 'Preserves # inside quotes');
  assertStrictEqualTest(parsedComments.active, true, 'Boolean with trailing comment');

  // 1.6 Multiline string in body and escaped newlines in YAML
  const multilineDoc = `---
description: "This is a single-line string with escaped\\nnewlines inside quotes."
tools:
  - view_file
  - run_command
  - write_to_file
hierarchy:
  tier: 1
  supervisor:
    id: lead-architect
    active: true
---

# Multi-line Markdown Prompt Body
This is line 1 of the prompt body.
This is line 2 of the prompt body with bullet points:
- Item A
- Item B
- Item C

End of instructions.
`;
  const parsedMultiDoc = parseFrontmatter(multilineDoc);
  assertTest(parsedMultiDoc.data.description.includes('escaped\nnewlines'), 'Escaped newline inside quoted scalar parsed');
  assertDeepStrictEqualTest(parsedMultiDoc.data.tools, ['view_file', 'run_command', 'write_to_file'], 'Block array parsed');
  assertStrictEqualTest(parsedMultiDoc.data.hierarchy.supervisor.id, 'lead-architect', 'Nested map parsed');
  assertStrictEqualTest(parsedMultiDoc.data.hierarchy.supervisor.active, true, 'Nested bool parsed');
  assertTest(parsedMultiDoc.body.includes('This is line 1 of the prompt body.'), 'Body line 1 preserved');
  assertTest(parsedMultiDoc.body.includes('- Item A'), 'Body markdown list preserved');
  assertTest(parsedMultiDoc.body.includes('End of instructions.'), 'Body ending preserved');

  // 1.7 Full Frontmatter Round-Trip Serialization
  const originalData = {
    id: 'roundtrip-agent',
    name: 'Roundtrip Test Specialist',
    role: 'QA Specialist',
    is_primary: false,
    allowed_tools: ['view_file', 'run_command'],
    delegation_targets: ['android-dev'],
    config: {
      timeout: 3000,
      retries: 3,
    },
  };
  const originalBody = '# Verification Role\nMust verify all acceptance tests.\n\n```javascript\nconsole.log("ready");\n```\n';
  const serialized = stringifyFrontmatter(originalData, originalBody);
  const reParsed = parseFrontmatter(serialized);
  assertStrictEqualTest(reParsed.data.id, originalData.id, 'Roundtrip agent id');
  assertStrictEqualTest(reParsed.data.name, originalData.name, 'Roundtrip agent name');
  assertStrictEqualTest(reParsed.data.is_primary, originalData.is_primary, 'Roundtrip is_primary');
  assertDeepStrictEqualTest(reParsed.data.allowed_tools, originalData.allowed_tools, 'Roundtrip tools');
  assertDeepStrictEqualTest(reParsed.data.delegation_targets, originalData.delegation_targets, 'Roundtrip targets');
  assertStrictEqualTest(reParsed.data.config.timeout, 3000, 'Roundtrip nested config timeout');
  assertTest(reParsed.body.includes('Must verify all acceptance tests.'), 'Roundtrip preserves body text');
  assertTest(reParsed.body.includes('console.log("ready");'), 'Roundtrip preserves body code blocks');

  console.log('  ✅ Frontmatter parser and YAML edge cases validated successfully.\n');

  // =========================================================================
  // SUITE 2: Validator & Schema Constraint Enforcement
  // =========================================================================
  console.log('▶ Suite 2: Validator & Schema Constraint Failures (Edge Cases & Errors)...');

  // 2.1 Null or undefined registry
  const nullVal = validateRegistry(null, PROJECT_ROOT);
  assertStrictEqualTest(nullVal.valid, false, 'Null registry fails validation');
  assertTest(nullVal.errors.some((e) => e.includes('null or undefined')), 'Null registry error message');

  // 2.2 Empty agents array
  const emptyAgentsVal = validateRegistry({ name: 'Empty', agents: [] }, PROJECT_ROOT);
  assertStrictEqualTest(emptyAgentsVal.valid, false, 'Empty agents list fails validation');
  assertTest(emptyAgentsVal.errors.some((e) => e.includes('at least one agent')), 'Empty agents error message');

  // 2.3 Non-existent orchestrator ID
  const missingOrchReg = {
    orchestrator: 'non-existent-lead',
    agents: [
      { id: 'sub-dev', role: 'Dev', allowed_tools: ['view_file'] },
    ],
  };
  const missingOrchVal = validateRegistry(missingOrchReg, PROJECT_ROOT);
  assertStrictEqualTest(missingOrchVal.valid, false, 'Missing orchestrator fails validation');
  assertTest(missingOrchVal.errors.some((e) => e.includes('does not exist in registered agents')), 'Orchestrator error logged');

  // 2.4 Duplicate agent IDs
  const duplicateReg = {
    orchestrator: 'agent-one',
    agents: [
      { id: 'agent-one', role: 'Lead', allowed_tools: ['view_file'] },
      { id: 'agent-one', role: 'Duplicate Lead', allowed_tools: ['view_file'] },
      { id: 'agent-two', role: 'Dev', allowed_tools: ['view_file'] },
    ],
  };
  const dupVal = validateRegistry(duplicateReg, PROJECT_ROOT);
  assertStrictEqualTest(dupVal.valid, false, 'Duplicate agent IDs fail validation');
  assertTest(dupVal.errors.some((e) => e.includes('Duplicate agent IDs found: agent-one')), 'Duplicate IDs error message');

  // 2.5 Invalid agent ID format (non-kebab-case)
  const invalidIdReg = {
    orchestrator: 'ValidLead',
    agents: [
      { id: 'ValidLead', role: 'Lead', allowed_tools: ['view_file'] },
      { id: 'snake_case_agent', role: 'Dev', allowed_tools: ['view_file'] },
      { id: 'agent with spaces', role: 'QA', allowed_tools: ['view_file'] },
    ],
  };
  const invalidIdVal = validateRegistry(invalidIdReg, PROJECT_ROOT);
  assertStrictEqualTest(invalidIdVal.valid, false, 'Invalid ID patterns fail validation');
  assertTest(invalidIdVal.errors.some((e) => e.includes('ValidLead') && e.includes('kebab-case')), 'Uppercase ID rejected');
  assertTest(invalidIdVal.errors.some((e) => e.includes('snake_case_agent') && e.includes('kebab-case')), 'Snake case ID rejected');
  assertTest(invalidIdVal.errors.some((e) => e.includes('agent with spaces') && e.includes('kebab-case')), 'Spaces in ID rejected');

  // 2.6 Dangling delegation targets
  const danglingReg = {
    orchestrator: 'lead-agent',
    agents: [
      { id: 'lead-agent', role: 'Lead', delegation_targets: ['ghost-agent', 'dev-agent'], allowed_tools: ['view_file'] },
      { id: 'dev-agent', role: 'Dev', allowed_tools: ['view_file'] },
    ],
  };
  const danglingVal = validateRegistry(danglingReg, PROJECT_ROOT);
  assertStrictEqualTest(danglingVal.valid, false, 'Dangling delegation target fails validation');
  assertTest(danglingVal.errors.some((e) => e.includes('ghost-agent')), 'Ghost agent error reported');

  // 2.7 Self-delegation target
  const selfDelegationReg = {
    orchestrator: 'lead-agent',
    agents: [
      { id: 'lead-agent', role: 'Lead', delegation_targets: ['lead-agent'], allowed_tools: ['view_file'] },
    ],
  };
  const selfDelVal = validateRegistry(selfDelegationReg, PROJECT_ROOT);
  assertStrictEqualTest(selfDelVal.valid, false, 'Self-delegation fails validation');
  assertTest(selfDelVal.errors.some((e) => e.includes('delegates to itself')), 'Self-delegation error reported');

  // 2.8 Unknown tools warning
  const unknownToolReg = {
    orchestrator: 'lead-agent',
    agents: [
      { id: 'lead-agent', role: 'Lead', allowed_tools: ['view_file', 'hack_mainframe', 'super_power'] },
    ],
  };
  const unknownToolVal = validateRegistry(unknownToolReg, PROJECT_ROOT);
  assertStrictEqualTest(unknownToolVal.valid, true, 'Unknown tools generate warnings, not errors');
  assertTest(unknownToolVal.warnings.some((w) => w.includes('hack_mainframe')), 'Unknown tool warning 1');
  assertTest(unknownToolVal.warnings.some((w) => w.includes('super_power')), 'Unknown tool warning 2');

  // 2.9 Missing skills enforcement (standard vs strict)
  const missingSkillReg = {
    orchestrator: 'lead-agent',
    agents: [
      { id: 'lead-agent', role: 'Lead', skills: ['non-existent-skill-xyz-999'], allowed_tools: ['view_file'] },
    ],
  };
  const standardMissingVal = validateRegistry(missingSkillReg, PROJECT_ROOT, { strict: false });
  assertStrictEqualTest(standardMissingVal.valid, true, 'Standard mode treats missing skills as warning');
  assertTest(standardMissingVal.warnings.some((w) => w.includes('non-existent-skill-xyz-999')), 'Missing skill warning');

  const strictMissingVal = validateRegistry(missingSkillReg, PROJECT_ROOT, { strict: true });
  assertStrictEqualTest(strictMissingVal.valid, false, 'Strict mode treats missing skills as errors');
  assertTest(strictMissingVal.errors.some((e) => e.includes('non-existent-skill-xyz-999')), 'Strict missing skill error');

  // 2.10 Cyclic delegation detection (2-node cycle and 3-node cycle)
  const cycle2 = [
    { id: 'agent-a', delegation_targets: ['agent-b'] },
    { id: 'agent-b', delegation_targets: ['agent-a'] },
  ];
  const detectedCycles2 = findDelegationCycles(cycle2);
  assertTest(detectedCycles2.length > 0, 'Detects 2-node cycle a -> b -> a');

  const cycle3 = [
    { id: 'agent-1', delegation_targets: ['agent-2'] },
    { id: 'agent-2', delegation_targets: ['agent-3'] },
    { id: 'agent-3', delegation_targets: ['agent-1'] },
  ];
  const detectedCycles3 = findDelegationCycles(cycle3);
  assertTest(detectedCycles3.length > 0, 'Detects 3-node cycle 1 -> 2 -> 3 -> 1');

  // 2.11 6-Category Schema Validation (reportsTo, handoffTo, tools aliases)
  const sixCategoryReg = {
    orchestrator: 'lead-agent',
    agents: [
      {
        id: 'lead-agent',
        name: 'Lead Agent',
        role: 'Tech Lead',
        persona: 'Architectural overseer',
        goal: 'Coordinate modules',
        tools: ['view_file', 'unknown_special_tool'],
        inputContract: 'Feature request',
        outputContract: 'Design doc',
        permissions: ['code:review'],
        prohibited_actions: ['No direct commits'],
        reportsTo: 'lead-agent', // self-reporting error
        handoffTo: ['dev-agent', 'ghost-subagent'], // ghost error
      },
      {
        id: 'dev-agent',
        name: 'Dev Agent',
        role: 'Developer',
        tools: ['view_file'],
        reportsTo: 'non-existent-lead', // non-existent reportsTo error
        handoffTo: ['lead-agent'],
      },
    ],
  };
  const sixCatVal = validateRegistry(sixCategoryReg, PROJECT_ROOT);
  assertStrictEqualTest(sixCatVal.valid, false, '6-category validation catches errors');
  assertTest(sixCatVal.errors.some((e) => e.includes('ghost-subagent')), 'HandoffTo ghost agent caught');
  assertTest(sixCatVal.errors.some((e) => e.includes('lead-agent') && e.includes('cannot report to itself')), 'Self reportsTo caught');
  assertTest(sixCatVal.errors.some((e) => e.includes('non-existent-lead') && e.includes('reports to non-existent agent')), 'Non-existent reportsTo caught');
  assertTest(sixCatVal.warnings.some((w) => w.includes('unknown_special_tool')), 'Tools alias unknown tool caught as warning');

  const cycleHandoff = [
    { id: 'x', handoffTo: ['y'] },
    { id: 'y', handoffTo: ['x'] },
  ];
  assertTest(findDelegationCycles(cycleHandoff).length > 0, 'Detects cycle using handoffTo');

  console.log('  ✅ Validator and schema constraint failure edge cases thoroughly verified.\n');

  // =========================================================================
  // SUITE 3: CLI Subcommands Execution Testing
  // =========================================================================
  console.log('▶ Suite 3: CLI Subcommand Invocations & Exit Code Verifications...');

  // 3.1 node bin/agents.js --help
  const helpOut = execSync(`node "${CLI_PATH}" --help`, { encoding: 'utf8', cwd: PROJECT_ROOT });
  assertTest(helpOut.includes('Universal AI Agent Registry CLI'), 'CLI help contains header');
  assertTest(helpOut.includes('sync'), 'CLI help lists sync command');
  assertTest(helpOut.includes('validate'), 'CLI help lists validate command');
  assertTest(helpOut.includes('doctor'), 'CLI help lists doctor command');

  // 3.2 node bin/agents.js validate
  const validateOut = execSync(`node "${CLI_PATH}" validate`, { encoding: 'utf8', cwd: PROJECT_ROOT });
  assertTest(validateOut.includes('Registry is completely valid!'), 'CLI validate exits 0 and reports completely valid');
  assertTest(validateOut.includes('Orchestrator:       tech-pm'), 'CLI validate identifies tech-pm');

  // 3.3 node bin/agents.js validate --json
  const validateJsonOut = execSync(`node "${CLI_PATH}" validate --json`, { encoding: 'utf8', cwd: PROJECT_ROOT });
  const validateJson = JSON.parse(validateJsonOut);
  assertStrictEqualTest(validateJson.valid, true, 'CLI validate --json output parsed valid: true');
  const canonicalRegistry = loadRegistry(PROJECT_ROOT);
  const expectedTeamCount = canonicalRegistry.agents.length;
  assertStrictEqualTest(validateJson.stats.agentsCount, expectedTeamCount, `CLI validate --json stats ${expectedTeamCount} agents`);

  // 3.4 node bin/agents.js sync --dry-run
  const syncDryRunOut = execSync(`node "${CLI_PATH}" sync --dry-run`, { encoding: 'utf8', cwd: PROJECT_ROOT });
  assertTest(syncDryRunOut.includes('DRY RUN: No files will be written to disk'), 'CLI sync dry-run displays warning message');
  assertTest(syncDryRunOut.includes('OPENCODE'), 'CLI sync dry-run includes OpenCode adapter');
  assertTest(syncDryRunOut.includes('CLAUDE'), 'CLI sync dry-run includes Claude adapter');
  assertTest(syncDryRunOut.includes('CODEX'), 'CLI sync dry-run includes Codex adapter');
  assertTest(syncDryRunOut.includes('GEMINI'), 'CLI sync dry-run includes Gemini adapter');

  // 3.5 node bin/agents.js sync --framework=claude
  const syncClaudeOut = execSync(`node "${CLI_PATH}" sync --framework=claude`, { encoding: 'utf8', cwd: PROJECT_ROOT });
  assertTest(syncClaudeOut.includes('[CLAUDE]'), 'CLI sync --framework=claude outputs [CLAUDE]');
  assertTest(!syncClaudeOut.includes('[CODEX]'), 'CLI sync --framework=claude excludes CODEX');
  assertTest(!syncClaudeOut.includes('[GEMINI]'), 'CLI sync --framework=claude excludes GEMINI');

  // 3.6 node bin/agents.js sync --framework=all
  const syncAllOut = execSync(`node "${CLI_PATH}" sync --framework=all`, { encoding: 'utf8', cwd: PROJECT_ROOT });
  assertTest(syncAllOut.includes('Successfully synchronized'), 'CLI sync --framework=all completes successfully');

  // 3.7 node bin/agents.js list --json
  const listJsonOut = execSync(`node "${CLI_PATH}" list --json`, { encoding: 'utf8', cwd: PROJECT_ROOT });
  const listJson = JSON.parse(listJsonOut);
  assertTest(Array.isArray(listJson), 'CLI list --json returns array');
  assertStrictEqualTest(listJson.length, expectedTeamCount, `CLI list --json returns ${expectedTeamCount} agents`);
  const expectedTeamIds = canonicalRegistry.agents.map((a) => a.id);
  const listedIds = listJson.map((a) => a.id);
  assertDeepStrictEqualTest(listedIds, expectedTeamIds, 'Agent list matches canonical IDs');

  // 3.8 node bin/agents.js skills
  const skillsOut = execSync(`node "${CLI_PATH}" skills`, { encoding: 'utf8', cwd: PROJECT_ROOT });
  assertTest(skillsOut.includes('task-decomposition'), 'CLI skills output contains task-decomposition');
  assertTest(/Total skills inspected: \d+/.test(skillsOut), 'CLI skills inspected all skills');

  // 3.9 node bin/agents.js skills --json
  const skillsJsonOut = execSync(`node "${CLI_PATH}" skills --json`, { encoding: 'utf8', cwd: PROJECT_ROOT });
  const skillsJson = JSON.parse(skillsJsonOut);
  assertTest(skillsJson.skillsMap !== undefined, 'CLI skills --json contains skillsMap');
  assertTest(skillsJson.skillUsage !== undefined, 'CLI skills --json contains skillUsage');
  assertStrictEqualTest(skillsJson.missingSkills.length, 0, 'No missing skills detected in repo');

  // 3.10 node bin/agents.js doctor
  const doctorOut = execSync(`node "${CLI_PATH}" doctor`, { encoding: 'utf8', cwd: PROJECT_ROOT });
  assertTest(doctorOut.includes('Overall Health: HEALTHY'), 'CLI doctor passes health check');
  assertTest(doctorOut.includes('Workspace Write Access'), 'CLI doctor checks write access');

  // 3.11 node bin/agents.js doctor --json
  const doctorJsonOut = execSync(`node "${CLI_PATH}" doctor --json`, { encoding: 'utf8', cwd: PROJECT_ROOT });
  const doctorJson = JSON.parse(doctorJsonOut);
  assertStrictEqualTest(doctorJson.passed, true, 'CLI doctor --json passed status is true');
  assertTest(doctorJson.checks.length >= 5, 'Doctor evaluated at least 5 subsystem checks');

  // 3.12 node bin/agents.js clean --framework=codex --dry-run
  const cleanCodexDryOut = execSync(`node "${CLI_PATH}" clean --framework=codex --dry-run`, { encoding: 'utf8', cwd: PROJECT_ROOT });
  assertTest(cleanCodexDryOut.includes('[dry-run] .codex/system-prompts.md'), 'Clean codex dry-run tracks system-prompts');
  assertTest(cleanCodexDryOut.includes('[dry-run] .codex/instructions.md'), 'Clean codex dry-run tracks instructions');

  // 3.13 Failure testing for invalid directory
  let nonExistentDirFailed = false;
  try {
    execSync(`node "${CLI_PATH}" validate --dir=/tmp/non_existent_project_dir_xyz`, { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    nonExistentDirFailed = true;
    assertStrictEqualTest(err.status, 1, 'Non-existent directory validate exits with code 1');
  }
  assertTest(nonExistentDirFailed, 'CLI handles non-existent registry directory gracefully');

  console.log('  ✅ CLI commands and option flags executed and asserted with 100% pass rate.\n');

  // =========================================================================
  // SUITE 4: Multi-Provider Artifact Content & Schema Verification
  // =========================================================================
  console.log('▶ Suite 4: Multi-Provider Artifact Content & Structural Integrity...');

  // Ensure fresh sync of all frameworks
  await syncAll(canonicalRegistry, PROJECT_ROOT, { framework: 'all' });

  // 4.1 OpenCode: AGENTS.md
  const agentsMdPath = path.join(PROJECT_ROOT, 'AGENTS.md');
  assertTest(fs.existsSync(agentsMdPath), 'AGENTS.md must exist');
  const agentsMd = fs.readFileSync(agentsMdPath, 'utf8');
  assertTest(agentsMd.includes('ALWAYS INVOKE `tech-pm` FIRST'), 'AGENTS.md enforces primary orchestrator invariant');
  assertTest(agentsMd.includes('flowchart TD'), 'AGENTS.md renders Mermaid flowchart');
  assertTest(agentsMd.includes('tech-pm["Scrum Master<br/><i>Tech Scrum Master (orchestrator)</i>"]'), 'AGENTS.md Mermaid diagram marks the orchestrator');
  assertTest(agentsMd.includes('| Agent | Role | Hands work to | Reports to | Never |'), 'AGENTS.md contains the team table');
  expectedTeamIds.forEach((id) => {
    assertTest(agentsMd.includes(`| \`${id}\` |`), `AGENTS.md roster includes ${id}`);
  });
  assertTest(!agentsMd.includes('file://'), 'AGENTS.md links are relative, not machine paths');
  assertTest(agentsMd.includes('## Registering subagents'), 'AGENTS.md includes the subagent registration note');

  // 4.2 OpenCode: .agents/rules/team-orchestration.md
  const rulePath = path.join(PROJECT_ROOT, '.agents', 'rules', 'team-orchestration.md');
  assertTest(fs.existsSync(rulePath), '.agents/rules/team-orchestration.md must exist');
  const ruleContent = fs.readFileSync(rulePath, 'utf8');
  const ruleFm = parseFrontmatter(ruleContent);
  assertStrictEqualTest(ruleFm.data.name, 'team-orchestration', 'Rule frontmatter name');
  assertStrictEqualTest(ruleFm.data.always_on, true, 'Rule frontmatter always_on: true');
  assertTest(ruleFm.body.includes('tech-pm'), 'Rule body references tech-pm');

  // 4.3 OpenCode: .agents/runtime-manifest.json
  const manifestPath = path.join(PROJECT_ROOT, '.agents', 'runtime-manifest.json');
  assertTest(fs.existsSync(manifestPath), '.agents/runtime-manifest.json must exist');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assertTest(typeof manifest.registeredAt === 'string', 'Runtime manifest has registeredAt timestamp');
  assertStrictEqualTest(manifest.orchestratorAgentId, 'tech-pm', 'Runtime manifest orchestratorAgentId');
  assertStrictEqualTest(manifest.totalAgents, expectedTeamCount, `Runtime manifest totalAgents is ${expectedTeamCount}`);
  assertTest(Array.isArray(manifest.agents), 'Runtime manifest agents is an array');
  assertStrictEqualTest(manifest.agents.length, expectedTeamCount, `Runtime manifest defines ${expectedTeamCount} compiled agents`);
  manifest.agents.forEach((ag) => {
    assertTest(typeof ag.id === 'string' && ag.id.length > 0, `Manifest agent ${ag.id} has ID`);
    assertTest(typeof ag.name === 'string' && ag.name.length > 0, `Manifest agent ${ag.id} has Name`);
    assertTest(typeof ag.role === 'string' && ag.role.length > 0, `Manifest agent ${ag.id} has Role`);
    assertTest(Array.isArray(ag.allowed_tools), `Manifest agent ${ag.id} has allowed_tools array`);
    assertTest(typeof ag.system_prompt === 'string' && ag.system_prompt.length > 50, `Manifest agent ${ag.id} has compiled system_prompt`);
  });

  // 4.4 OpenCode: .agents/agents.json (Backward-Compatibility)
  const legacyJsonPath = path.join(PROJECT_ROOT, '.agents', 'agents.json');
  assertTest(fs.existsSync(legacyJsonPath), '.agents/agents.json must exist');
  const legacyJson = JSON.parse(fs.readFileSync(legacyJsonPath, 'utf8'));
  assertStrictEqualTest(legacyJson.version, '1.0.0', 'Legacy agents.json version');
  assertStrictEqualTest(legacyJson.agents.length, expectedTeamCount, `Legacy agents.json contains ${expectedTeamCount} agents`);
  const legacyPm = legacyJson.agents.find((a) => a.id === 'tech-pm');
  assertStrictEqualTest(legacyPm.id, 'tech-pm', 'Legacy pm has id tech-pm');
  assertTest(legacyPm.enable_subagent_tools === true, 'Legacy pm enable_subagent_tools true');

  // 4.5 Claude Code: CLAUDE.md & .claude/config.json
  const claudeMdPath = path.join(PROJECT_ROOT, 'CLAUDE.md');
  assertTest(fs.existsSync(claudeMdPath), 'CLAUDE.md must exist');
  const claudeMd = fs.readFileSync(claudeMdPath, 'utf8');
  assertTest(claudeMd.includes('Route every software request to `tech-pm`'), 'CLAUDE.md defines primary routing');
  assertTest(claudeMd.includes('## Team') && claudeMd.includes('| `web-tech-lead` | Tech Lead | `web-dev` |'), 'CLAUDE.md team table shows delegation');
  assertTest(claudeMd.includes('## Commands'), 'CLAUDE.md defines project commands');
  assertTest(claudeMd.includes('node bin/agents.js validate'), 'CLAUDE.md documents validate CLI command');
  assertTest(claudeMd.includes('sync'), 'CLAUDE.md documents sync CLI command');
  assertTest(claudeMd.includes('No direct application code modifications'), 'CLAUDE.md lists prohibited actions');
  assertTest(!claudeMd.includes('file://'), 'CLAUDE.md links are relative, not machine paths');

  const claudeConfigPath = path.join(PROJECT_ROOT, '.claude', 'config.json');
  assertTest(fs.existsSync(claudeConfigPath), '.claude/config.json must exist');
  const claudeConfig = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf8'));
  assertStrictEqualTest(claudeConfig.version, '2.0.0', 'Claude config version');
  assertStrictEqualTest(claudeConfig.orchestrator, 'tech-pm', 'Claude config orchestrator');
  assertTest(claudeConfig.team && Array.isArray(claudeConfig.team.agents), 'Claude config team.agents array');
  assertStrictEqualTest(claudeConfig.team.agents.length, expectedTeamCount, `Claude config covers all ${expectedTeamCount} agents`);
  const claudePm = claudeConfig.team.agents.find((a) => a.id === 'tech-pm');
  assertStrictEqualTest(claudePm.primary, true, 'Claude config marks tech-pm primary');
  assertTest(claudeConfig.preferences.strictOrchestratorRouting === true, 'Claude config strictOrchestratorRouting');

  // 4.6 OpenAI Codex: .codex/instructions.md & .codex/system-prompts.md
  const codexInstrPath = path.join(PROJECT_ROOT, '.codex', 'instructions.md');
  assertTest(fs.existsSync(codexInstrPath), '.codex/instructions.md must exist');
  const codexInstr = fs.readFileSync(codexInstrPath, 'utf8');
  assertTest(codexInstr.includes('as `tech-pm` (Scrum Master), the orchestrator'), 'Codex instructions identifies primary orchestrator');
  assertTest(codexInstr.includes('## Team'), 'Codex instructions team table');
  assertTest(codexInstr.includes('No direct application code modifications'), 'Codex instructions preserves prohibited actions');

  const codexPromptsPath = path.join(PROJECT_ROOT, '.codex', 'system-prompts.md');
  assertTest(fs.existsSync(codexPromptsPath), '.codex/system-prompts.md must exist');
  const codexPrompts = fs.readFileSync(codexPromptsPath, 'utf8');
  assertTest(codexPrompts.includes(': role prompts'), 'Codex system prompts header');
  assertTest(codexPrompts.includes(`## Agent Prompt: \`${expectedTeamIds[expectedTeamIds.length - 1]}\``), `Codex system prompt for ${expectedTeamIds[expectedTeamIds.length - 1]}`);

  // 4.7 Gemini CLI: GEMINI.md
  const geminiMdPath = path.join(PROJECT_ROOT, 'GEMINI.md');
  assertTest(fs.existsSync(geminiMdPath), 'GEMINI.md must exist');
  const geminiMd = fs.readFileSync(geminiMdPath, 'utf8');
  assertTest(geminiMd.includes('Route every software request to `tech-pm`'), 'GEMINI.md primary orchestrator routing');
  assertTest(geminiMd.includes('## Team'), 'GEMINI.md team table');
  assertTest(geminiMd.includes('## Delegation') && geminiMd.includes('Your task: <KEY>'), 'GEMINI.md delegation prompt carries only the card key');
  assertTest(!geminiMd.includes('"Prompt":'), 'GEMINI.md no longer asks for instructions in the delegation prompt');
  assertTest(geminiMd.includes('## Skills') && !geminiMd.includes('file://'), 'GEMINI.md skills use relative links');

  console.log('  ✅ Content and structure verification of all multi-provider artifacts passed.\n');

  // =========================================================================
  // SUITE 5: Clean & Restore Idempotency in Sandbox Environment
  // =========================================================================
  console.log('▶ Suite 5: Clean & Restore Idempotency in Isolated Sandbox...');

  // Create an isolated temporary sandbox project directory
  const tempProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'virtual-office-test-sandbox-'));

  try {
    // Scaffold minimal canonical structure
    fs.mkdirSync(path.join(tempProjectDir, '.agents', 'definitions'), { recursive: true });
    fs.mkdirSync(path.join(tempProjectDir, '.agents', 'skills', 'mock-skill'), { recursive: true });
    fs.writeFileSync(path.join(tempProjectDir, '.agents', 'skills', 'mock-skill', 'SKILL.md'), '# Mock Skill\nInstructions here.');

    const sandboxManifest = `
version: "2.0.0"
name: "Sandbox Virtual Office"
orchestrator: "lead-architect"
`;
    fs.writeFileSync(path.join(tempProjectDir, '.agents', 'registry.yaml'), sandboxManifest);

    const leadAgentDoc = `---
id: lead-architect
name: Lead Architect
role: Technical Lead
is_primary: true
allowed_tools:
  - view_file
  - invoke_subagent
delegation_targets:
  - code-author
skills:
  - mock-skill
---

# Lead Architect Instructions
Coordinate technical implementation.
`;
    fs.writeFileSync(path.join(tempProjectDir, '.agents', 'definitions', 'lead-architect.md'), leadAgentDoc);

    const devAgentDoc = `---
id: code-author
name: Code Author
role: Senior Developer
is_primary: false
allowed_tools:
  - view_file
  - write_to_file
delegation_targets:
  - lead-architect
skills:
  - mock-skill
---

# Code Author Instructions
Implement features.
`;
    fs.writeFileSync(path.join(tempProjectDir, '.agents', 'definitions', 'code-author.md'), devAgentDoc);

    // 5.1 Load and Validate Sandbox
    assertStrictEqualTest(hasCanonicalRegistry(tempProjectDir), true, 'Sandbox detected canonical registry');
    const sandboxRegistry = loadRegistry(tempProjectDir);
    assertStrictEqualTest(sandboxRegistry.agents.length, 2, 'Sandbox loaded 2 agents');
    const sandboxVal = validateRegistry(sandboxRegistry, tempProjectDir);
    assertStrictEqualTest(sandboxVal.valid, true, 'Sandbox registry is valid');

    // 5.2 Sync all providers in sandbox
    const sandboxSync = await syncAll(sandboxRegistry, tempProjectDir, { framework: 'all' });
    assertTest(sandboxSync.totalFilesWritten >= 9, 'Sandbox generated all target files');

    // Verify files exist in sandbox
    assertTest(fs.existsSync(path.join(tempProjectDir, 'AGENTS.md')), 'Sandbox AGENTS.md exists');
    assertTest(fs.existsSync(path.join(tempProjectDir, 'CLAUDE.md')), 'Sandbox CLAUDE.md exists');
    assertTest(fs.existsSync(path.join(tempProjectDir, '.codex', 'instructions.md')), 'Sandbox .codex/instructions.md exists');
    assertTest(fs.existsSync(path.join(tempProjectDir, 'GEMINI.md')), 'Sandbox GEMINI.md exists');

    // 5.3 Clean all providers in sandbox
    const sandboxClean = await cleanAll(tempProjectDir, { framework: 'all' });
    const cleanedCount = Object.values(sandboxClean).reduce((acc, c) => acc + (c.cleanedFiles ? c.cleanedFiles.length : 0), 0);
    assertTest(cleanedCount >= 9, `Sandbox clean removed all generated files (count: ${cleanedCount})`);

    // Verify files were removed
    assertTest(!fs.existsSync(path.join(tempProjectDir, 'AGENTS.md')), 'Sandbox AGENTS.md was removed');
    assertTest(!fs.existsSync(path.join(tempProjectDir, 'CLAUDE.md')), 'Sandbox CLAUDE.md was removed');
    assertTest(!fs.existsSync(path.join(tempProjectDir, '.codex', 'instructions.md')), 'Sandbox Codex files were removed');
    assertTest(!fs.existsSync(path.join(tempProjectDir, 'GEMINI.md')), 'Sandbox GEMINI.md was removed');

    // Verify SSOT files were NEVER deleted by clean
    assertTest(fs.existsSync(path.join(tempProjectDir, '.agents', 'registry.yaml')), 'Clean preserves registry.yaml');
    assertTest(fs.existsSync(path.join(tempProjectDir, '.agents', 'definitions', 'lead-architect.md')), 'Clean preserves lead-architect.md');
    assertTest(fs.existsSync(path.join(tempProjectDir, '.agents', 'definitions', 'code-author.md')), 'Clean preserves code-author.md');
    assertTest(fs.existsSync(path.join(tempProjectDir, '.agents', 'skills', 'mock-skill', 'SKILL.md')), 'Clean preserves SKILL.md');

    // 5.4 Re-sync after clean
    const restoreSync = await syncAll(sandboxRegistry, tempProjectDir, { framework: 'all' });
    assertTest(restoreSync.totalFilesWritten >= 9, 'Sandbox re-sync restored all provider files');
    assertTest(fs.existsSync(path.join(tempProjectDir, 'AGENTS.md')), 'Sandbox AGENTS.md restored');
    assertTest(fs.existsSync(path.join(tempProjectDir, 'GEMINI.md')), 'Sandbox GEMINI.md restored');

    console.log('  ✅ Clean and restore idempotency verified in isolated sandbox.\n');
  } finally {
    // Cleanup temporary directory
    fs.rmSync(tempProjectDir, { recursive: true, force: true });
  }

  // =========================================================================
  // SUMMARY REPORT
  // =========================================================================
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🎉 ALL UNIVERSAL AGENT REGISTRY E2E & REGRESSION TESTS PASSED!`);
  console.log(`📊 Total Assertions: ${totalAssertions} / ${passedAssertions} (100% Pass Rate)`);
  console.log(`⏱️  Execution Duration: ${duration}s`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

runE2ESuite().catch((err) => {
  console.error('\n❌ E2E TEST FAILED:', err);
  process.exit(1);
});
