const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { discoverAgents } = require('../server/agentDiscovery');

console.log('🧪 Starting Agents Folder Discovery Test (No agents.json)...\n');

// Create a temporary project directory without any agents.json
const tempProjDir = path.join(os.tmpdir(), `test-virtual-office-agents-folder-${Date.now()}`);
fs.mkdirSync(tempProjDir, { recursive: true });

try {
  // Scenario 1: User created an `.agents` folder with:
  // - 1 JSON agent file (project-manager.json)
  // - 1 Markdown agent file with YAML frontmatter (android-tech-lead.md)
  // - 1 Markdown agent file with bullet points (developer.md)
  // - 1 Agent in a subdirectory (.agents/tester/agent.json)
  // - 1 YAML agent file (security-auditor.yaml)
  const agentsDir = path.join(tempProjDir, '.agents');
  fs.mkdirSync(agentsDir, { recursive: true });

  // 1. JSON agent
  fs.writeFileSync(
    path.join(agentsDir, 'delivery-pm.json'),
    JSON.stringify({
      id: 'delivery-pm',
      name: 'Delivery Orchestrator',
      role: 'Agile Delivery Lead',
      description: 'Coordinates sprint priorities and stakeholder reporting.',
      skills: ['sprint-intake', 'delivery-metrics'],
      delegation_targets: ['mobile-tech-lead', 'android-dev'],
    }, null, 2)
  );

  // 2. Markdown agent with YAML frontmatter
  fs.writeFileSync(
    path.join(agentsDir, 'mobile-tech-lead.md'),
    `---
id: mobile-tech-lead
name: Mobile Architecture Lead
role: Principal Mobile Architect
description: Establishes mobile boundary contracts and approves PRs.
skills:
  - mobile-architecture
  - pr-review-gate
delegation_targets:
  - android-dev
  - test-automation-eng
---
# System Prompt & Context
You are the Mobile Architecture Lead for this project.
`
  );

  // 3. Markdown agent with headers & bullet points
  fs.writeFileSync(
    path.join(agentsDir, 'android-dev.md'),
    `# Jetpack Compose Developer
**ID**: android-dev
**Role**: Senior Android Engineer
**Description**: Implements Compose UI, ViewModels, and repository layers.
## Skills
- compose-screen
- coroutines-flow
- room-database
## Delegation Targets
- mobile-tech-lead
`
  );

  // 4. Subdirectory agent (.agents/test-automation-eng/agent.json)
  const testerSubDir = path.join(agentsDir, 'test-automation-eng');
  fs.mkdirSync(testerSubDir, { recursive: true });
  fs.writeFileSync(
    path.join(testerSubDir, 'agent.json'),
    JSON.stringify({
      id: 'test-automation-eng',
      name: 'QA & Test Automation Lead',
      role: 'Quality Assurance Architect',
      description: 'Maintains end-to-end regression suites and unit test runners.',
      skills: ['junit5-suite', 'espresso-ui'],
      delegation_targets: ['android-dev', 'delivery-pm'],
    }, null, 2)
  );

  // 5. YAML agent
  fs.writeFileSync(
    path.join(agentsDir, 'security-auditor.yaml'),
    `id: security-auditor
name: Security & Compliance Auditor
role: InfoSec Specialist
description: Validates OWASP MASVS mobile security standards.
skills:
  - dependency-audit
  - static-analysis
delegation_targets:
  - mobile-tech-lead
`
  );

  console.log('Testing discovery in project without agents.json:');
  const discovered = discoverAgents(tempProjDir);
  console.log(`Discovered ${discovered.length} agents directly from folder definitions:\n`);

  for (const a of discovered) {
    console.log(`  - [${a.badgeText}] ${a.name} (${a.id})`);
    console.log(`      Role: ${a.role}`);
    console.log(`      Skills: ${a.skillIds.join(', ')}`);
    console.log(`      Delegation Targets: ${a.delegationTargets.join(', ')}`);
    console.log(`      Origin: ${a.origin}`);
    console.log(`      Desk Position: (${a.theme.deskPosition.x}, ${a.theme.deskPosition.y})`);
    console.log('');
  }

  // Assertions
  assert.strictEqual(discovered.length, 5, 'Must discover all 5 agents defined across folder files');

  const pm = discovered.find(a => a.id === 'delivery-pm');
  assert(pm, 'Must find delivery-pm from JSON file');
  assert.strictEqual(pm.role, 'Agile Delivery Lead');
  assert.deepStrictEqual(pm.delegationTargets, ['mobile-tech-lead', 'android-dev']);

  const lead = discovered.find(a => a.id === 'mobile-tech-lead');
  assert(lead, 'Must find mobile-tech-lead from Markdown frontmatter');
  assert.strictEqual(lead.role, 'Principal Mobile Architect');
  assert.deepStrictEqual(lead.skillIds, ['mobile-architecture', 'pr-review-gate']);

  const dev = discovered.find(a => a.id === 'android-dev');
  assert(dev, 'Must find android-dev from Markdown bullet points');
  assert.strictEqual(dev.role, 'Senior Android Engineer');
  assert.deepStrictEqual(dev.delegationTargets, ['mobile-tech-lead']);

  const qa = discovered.find(a => a.id === 'test-automation-eng');
  assert(qa, 'Must find test-automation-eng from subdirectory agent.json');
  assert.strictEqual(qa.role, 'Quality Assurance Architect');

  const sec = discovered.find(a => a.id === 'security-auditor');
  assert(sec, 'Must find security-auditor from YAML file');
  assert.strictEqual(sec.role, 'InfoSec Specialist');

  console.log('🎉 ALL AGENTS FOLDER DISCOVERY TESTS PASSED 100%!\n');

} finally {
  // Cleanup temp directory
  try {
    fs.rmSync(tempProjDir, { recursive: true, force: true });
  } catch (e) {}
}
