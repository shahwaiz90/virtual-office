#!/usr/bin/env node

/**
 * Universal AI Agent Registry CLI (`agents`)
 *
 * Single Source of Truth management for multi-provider agent environments.
 */

const path = require('path');
const fs = require('fs');
const { loadRegistry, hasCanonicalRegistry } = require('../server/registry/canonicalRegistry');
const { validateRegistry } = require('../server/registry/validator');
const { syncAll, cleanAll, getAllAdapters } = require('../server/adapters');
const { runDoctor, formatDoctorReport } = require('../server/registry/doctor');
const { migrateProject } = require('../server/registry/migration');
const { RegistryWatcher } = require('../server/registry/watcher');

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0] && !args[0].startsWith('-') ? args[0] : 'help';
  const options = {
    framework: 'all',
    dryRun: false,
    watch: false,
    strict: false,
    json: false,
    dir: process.cwd(),
    filter: null,
    missing: false,
    force: false,
  };

  const startIndex = command === 'help' ? 0 : 1;
  for (let i = startIndex; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      return { command: 'help', options };
    }
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--watch' || arg === '-w') options.watch = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--missing') options.missing = true;
    else if (arg === '--force') options.force = true;
    else if (arg.startsWith('--framework=')) options.framework = arg.split('=')[1];
    else if (arg === '--framework' && args[i + 1]) { options.framework = args[++i]; }
    else if (arg.startsWith('--dir=')) options.dir = path.resolve(arg.split('=')[1]);
    else if (arg === '--dir' && args[i + 1]) { options.dir = path.resolve(args[++i]); }
    else if (arg.startsWith('--filter=')) options.filter = arg.split('=')[1];
    else if (arg === '--filter' && args[i + 1]) { options.filter = args[++i]; }
  }

  return { command, options };
}

function showHelp() {
  console.log(`
🤖 Universal AI Agent Registry CLI (agents)

Usage:
  agents <command> [options]

Commands:
  sync       Compile canonical registry into provider artifacts (AGENTS.md, CLAUDE.md, etc.)
  validate   Validate schema integrity, skill paths, delegation targets, and cycles
  list       List registered agents, roles, tools, and delegation targets
  skills     Audit registered skills, per-agent assignments, and missing docs
  doctor     Run deep diagnostic health check on project and provider sync state
  clean      Safely clean generated provider artifacts without modifying canonical files
  migrate    Migrate legacy .agents/agents.json to canonical definitions/*.md & registry.yaml

Options:
  --dir=<path>         Target project directory (default: current directory)
  --framework=<name>   Target provider adapter ('all', 'opencode', 'claude', 'codex', 'gemini')
  --dry-run            Preview file changes without writing to disk
  --watch, -w          Watch canonical definitions and auto-sync on file edits
  --strict             Treat warnings (missing skills, cycles) as validation failures
  --json               Output machine-readable JSON format
  --filter=<id>        Filter results by skill ID or agent ID
  --missing            Only show missing or dangling skills
  -h, --help           Show this help message
`);
}

async function handleSync(options) {
  const projectRoot = options.dir;
  const registry = loadRegistry(projectRoot);
  if (!registry) {
    console.error(`❌ No valid agent registry found in ${projectRoot}`);
    console.error(`Run "agents migrate" if you have a legacy .agents/agents.json`);
    process.exit(1);
  }

  console.log(`🔄 Synchronizing agent registry for "${registry.name}" (${options.framework})...`);
  if (options.dryRun) {
    console.log(`⚠️  DRY RUN: No files will be written to disk.`);
  }

  const result = await syncAll(registry, projectRoot, options);

  console.log(`\n📦 Synchronization Summary:`);
  Object.entries(result.results).forEach(([adapterName, res]) => {
    console.log(`  • [${adapterName.toUpperCase()}]`);
    (res.filesWritten || []).forEach((f) => {
      console.log(`     ✓ ${path.relative(projectRoot, f.path)} (${f.size} bytes)`);
    });
    (res.warnings || []).forEach((w) => {
      console.log(`     ⚠️  ${w}`);
    });
  });

  console.log(`\n✨ Successfully synchronized ${result.totalFilesWritten} provider files.`);

  if (options.watch) {
    console.log('\n👀 Watch mode enabled. Press Ctrl+C to exit.');
    const watcher = new RegistryWatcher(projectRoot, options);
    watcher.start();
    // Keep process alive
    process.on('SIGINT', () => {
      watcher.stop();
      process.exit(0);
    });
  }
}

async function handleValidate(options) {
  const projectRoot = options.dir;
  const registry = loadRegistry(projectRoot);
  if (!registry) {
    console.error(`❌ No agent registry found in ${projectRoot}`);
    process.exit(1);
  }

  const result = validateRegistry(registry, projectRoot, options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.valid ? 0 : 1);
  }

  console.log(`\n🔍 Validating Canonical Agent Registry for "${registry.name}"...`);
  console.log(`━`.repeat(60));
  console.log(`  Orchestrator:       ${registry.orchestrator || 'None'}`);
  console.log(`  Registered Agents:  ${result.stats.agentsCount}`);
  console.log(`  Referenced Skills:  ${result.stats.skillsCount}`);

  if (result.errors.length > 0) {
    console.log(`\n❌ Validation Errors (${result.errors.length}):`);
    result.errors.forEach((e) => console.log(`  • ${e}`));
  }

  if (result.warnings.length > 0) {
    console.log(`\n⚠️  Warnings (${result.warnings.length}):`);
    result.warnings.forEach((w) => console.log(`  • ${w}`));
  }

  if (result.valid) {
    console.log(`\n✅ Registry is completely valid!`);
    process.exit(0);
  } else {
    console.log(`\n❌ Registry validation failed.`);
    process.exit(1);
  }
}

async function handleList(options) {
  const projectRoot = options.dir;
  const registry = loadRegistry(projectRoot);
  if (!registry) {
    console.error(`❌ No agent registry found in ${projectRoot}`);
    process.exit(1);
  }

  const agents = registry.agents || [];

  if (options.json) {
    console.log(JSON.stringify(agents, null, 2));
    return;
  }

  console.log(`\n📋 Registered AI Agents in "${registry.name}" (Orchestrator: ${registry.orchestrator}):\n`);
  console.log(`| Status | ID | Role | Tools | Delegation Targets | Skills Count |`);
  console.log(`| :--- | :--- | :--- | :--- | :--- | :--- |`);

  agents.forEach((ag) => {
    const isOrch = ag.id === registry.orchestrator;
    const badge = isOrch ? '👑 Primary' : '🧩 Subagent';
    const tools = (ag.allowed_tools || []).length;
    const targets = (ag.delegation_targets || []).join(', ') || 'None';
    const skills = (ag.skillIds || []).length;
    console.log(`| ${badge} | **\`${ag.id}\`** | ${ag.role} | ${tools} tools | ${targets} | ${skills} skills |`);
  });
  console.log('');
}

async function handleSkills(options) {
  const projectRoot = options.dir;
  const registry = loadRegistry(projectRoot);
  if (!registry) {
    console.error(`❌ No agent registry found in ${projectRoot}`);
    process.exit(1);
  }

  const valResult = validateRegistry(registry, projectRoot);
  const skillsMap = registry.skills || {};
  const agents = registry.agents || [];

  // Map skill usage
  const skillUsage = {};
  agents.forEach((ag) => {
    (ag.skillIds || []).forEach((skId) => {
      if (!skillUsage[skId]) skillUsage[skId] = [];
      skillUsage[skId].push(ag.id);
    });
  });

  const allSkillIds = Array.from(new Set([...Object.keys(skillsMap), ...Object.keys(skillUsage)]));
  allSkillIds.sort();

  if (options.json) {
    console.log(JSON.stringify({
      skillsMap,
      skillUsage,
      missingSkills: valResult.stats.missingSkills,
      orphanSkills: valResult.stats.orphanSkills,
    }, null, 2));
    return;
  }

  console.log(`\n🧠 Domain Skills Audit for "${registry.name}":\n`);

  let count = 0;
  for (const skId of allSkillIds) {
    if (options.filter && !skId.includes(options.filter)) continue;
    const isMissing = valResult.stats.missingSkills.includes(skId);
    if (options.missing && !isMissing) continue;

    const assignedAgents = skillUsage[skId] || [];
    const meta = skillsMap[skId];
    const statusIcon = isMissing ? '❌ Missing' : (assignedAgents.length === 0 ? '⚠️  Orphan' : '✅ Active');

    console.log(`[${statusIcon}] \`${skId}\``);
    if (meta && meta.description) {
      console.log(`   Description: ${meta.description}`);
    }
    console.log(`   Assigned Agents: ${assignedAgents.length > 0 ? assignedAgents.map((a) => `\`${a}\``).join(', ') : 'None'}`);
    count++;
  }

  console.log(`\nTotal skills inspected: ${count}`);
}

async function handleDoctor(options) {
  const projectRoot = options.dir;
  const report = await runDoctor(projectRoot);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.passed ? 0 : 1);
  }

  console.log(formatDoctorReport(report));
  process.exit(report.passed ? 0 : 1);
}

async function handleClean(options) {
  const projectRoot = options.dir;
  console.log(`🧹 Cleaning generated provider files (${options.framework})...`);
  const result = await cleanAll(projectRoot, options);
  console.log(JSON.stringify(result, null, 2));
}

async function handleMigrate(options) {
  const projectRoot = options.dir;
  console.log(`📦 Migrating legacy agent configuration in ${projectRoot}...`);
  try {
    const result = await migrateProject(projectRoot, options);
    console.log(`\n✅ Migration successful!`);
    console.log(`  • Backup created in: ${result.backupDir}`);
    console.log(`  • Agents migrated:   ${result.agentsMigrated.join(', ')}`);
    console.log(`  • Files created:     ${result.filesCreated.join(', ')}`);
    console.log(`\nNext step: Run "agents sync" to compile multi-provider artifacts.`);
  } catch (err) {
    console.error(`❌ Migration failed:`, err.message);
    process.exit(1);
  }
}

async function main() {
  const { command, options } = parseArgs(process.argv);

  switch (command) {
    case 'sync':
      await handleSync(options);
      break;
    case 'validate':
      await handleValidate(options);
      break;
    case 'list':
      await handleList(options);
      break;
    case 'skills':
      await handleSkills(options);
      break;
    case 'doctor':
      await handleDoctor(options);
      break;
    case 'clean':
      await handleClean(options);
      break;
    case 'migrate':
      await handleMigrate(options);
      break;
    case 'help':
    default:
      showHelp();
      break;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal CLI Error:', err);
    process.exit(1);
  });
}

module.exports = { main, parseArgs };
