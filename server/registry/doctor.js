/**
 * Doctor Diagnostic Engine for Universal AI Agent Registry
 *
 * Runs comprehensive system and project health checks:
 * 1. Canonical registry presence & syntax (.agents/registry.yaml, definitions/*.md)
 * 2. Agent definitions validity & tool whitelist checks
 * 3. Skill references vs disk files (.agents/skills/*)
 * 4. Provider adapter outputs synchronization state
 * 5. File permissions (read / write)
 * 6. Actionable recommendations & remedies
 */

const fs = require('fs');
const path = require('path');
const { loadRegistry, hasCanonicalRegistry } = require('./canonicalRegistry');
const { validateRegistry } = require('./validator');
const { getAllAdapters } = require('../adapters');

/**
 * Runs all diagnostics on the specified project root.
 *
 * @param {string} projectRoot
 * @returns {Promise<{ checks: Array<{ category: string, name: string, status: 'pass'|'warn'|'fail', message: string, remedy?: string }>, passed: boolean }>}
 */
async function runDoctor(projectRoot = process.cwd()) {
  const checks = [];

  function addCheck(category, name, status, message, remedy = null) {
    checks.push({ category, name, status, message, remedy });
  }

  // 1. Filesystem & Write Permissions Check
  try {
    const testFile = path.join(projectRoot, '.agents', `.doctor_perm_test_${Date.now()}`);
    const agentsDir = path.join(projectRoot, '.agents');
    if (!fs.existsSync(agentsDir)) {
      fs.mkdirSync(agentsDir, { recursive: true });
    }
    fs.writeFileSync(testFile, 'ok', 'utf8');
    fs.unlinkSync(testFile);
    addCheck('Permissions', 'Workspace Write Access', 'pass', 'Write access to .agents directory verified.');
  } catch (err) {
    addCheck('Permissions', 'Workspace Write Access', 'fail', `Cannot write to .agents: ${err.message}`, 'Check directory write permissions for current user.');
  }

  // 2. Canonical Registry Check
  const hasCanonical = hasCanonicalRegistry(projectRoot);
  const legacyConfig = path.join(projectRoot, '.agents', 'agents.json');

  if (hasCanonical) {
    addCheck('Canonical Registry', 'Manifest & Definitions', 'pass', 'Canonical registry (.agents/registry.yaml or definitions/*.md) detected.');
  } else if (fs.existsSync(legacyConfig)) {
    addCheck(
      'Canonical Registry',
      'Manifest & Definitions',
      'warn',
      'Legacy .agents/agents.json detected, but no canonical .agents/registry.yaml found.',
      'Run "agents migrate" to upgrade to the canonical registry format.'
    );
  } else {
    addCheck(
      'Canonical Registry',
      'Manifest & Definitions',
      'fail',
      'No agent definitions or configuration found.',
      'Create .agents/registry.yaml or run "agents migrate" if you have a legacy configuration.'
    );
  }

  // 3. Load & Validate Registry
  const registry = loadRegistry(projectRoot);
  if (!registry || !registry.agents || registry.agents.length === 0) {
    addCheck('Validation', 'Agent Validation', 'fail', 'Unable to parse any agents from registry.', 'Check YAML/Markdown formatting in .agents/definitions/');
  } else {
    const valResult = validateRegistry(registry, projectRoot);

    if (valResult.valid) {
      addCheck('Validation', 'Schema & Constraints', 'pass', `All ${valResult.stats.agentsCount} agents valid. Orchestrator: "${registry.orchestrator}".`);
    } else {
      addCheck('Validation', 'Schema & Constraints', 'fail', `Validation errors: ${valResult.errors.join('; ')}`, 'Fix the reported schema errors in agent definition files.');
    }

    if (valResult.warnings.length > 0) {
      addCheck('Validation', 'Best Practice Warnings', 'warn', valResult.warnings.join('; '));
    }

    // 4. Skills Audit
    const missingSkills = valResult.stats.missingSkills || [];
    if (missingSkills.length === 0) {
      addCheck('Skills', 'Skill Documentation', 'pass', `All ${valResult.stats.skillsCount} referenced skills exist on disk.`);
    } else {
      addCheck(
        'Skills',
        'Skill Documentation',
        'warn',
        `Missing SKILL.md for: ${missingSkills.join(', ')}`,
        'Create missing SKILL.md files under .agents/skills/<skill-id>/SKILL.md or remove unused skills.'
      );
    }

    if (valResult.stats.orphanSkills && valResult.stats.orphanSkills.length > 0) {
      addCheck(
        'Skills',
        'Unassigned Skills',
        'warn',
        `${valResult.stats.orphanSkills.length} skill(s) on disk are not assigned to any agent: ${valResult.stats.orphanSkills.slice(0, 5).join(', ')}${valResult.stats.orphanSkills.length > 5 ? '...' : ''}`
      );
    }

    // 5. Provider Adapters Check
    const adapters = getAllAdapters();
    for (const adapter of adapters) {
      const v = await adapter.validate(projectRoot, registry);
      if (v.valid) {
        addCheck('Adapters', `Provider: ${adapter.name}`, 'pass', `Target files present: ${adapter.targetFiles.join(', ')}`);
      } else {
        addCheck(
          'Adapters',
          `Provider: ${adapter.name}`,
          'warn',
          `Missing generated file(s): ${v.missingFiles.join(', ')}`,
          `Run "agents sync --framework=${adapter.name}" to generate provider artifacts.`
        );
      }
    }
  }

  const passed = !checks.some((c) => c.status === 'fail');

  return {
    checks,
    passed,
    projectRoot,
  };
}

/**
 * Formats doctor diagnostic output for CLI display.
 */
function formatDoctorReport(report) {
  const lines = [];
  lines.push('');
  lines.push('🏥 Universal AI Agent Registry — Health Doctor Report');
  lines.push('━'.repeat(60));

  const statusIcons = {
    pass: '✅ PASS',
    warn: '⚠️  WARN',
    fail: '❌ FAIL',
  };

  let currentCategory = '';
  report.checks.forEach((chk) => {
    if (chk.category !== currentCategory) {
      currentCategory = chk.category;
      lines.push(`\n[${currentCategory}]`);
    }
    const icon = statusIcons[chk.status] || chk.status;
    lines.push(`  ${icon.padEnd(8)} ${chk.name}: ${chk.message}`);
    if (chk.remedy) {
      lines.push(`           💡 Remedy: ${chk.remedy}`);
    }
  });

  lines.push('\n' + '━'.repeat(60));
  if (report.passed) {
    lines.push('🎉 Overall Health: HEALTHY (All critical checks passed)');
  } else {
    lines.push('🚨 Overall Health: ISSUES DETECTED (Review failed checks above)');
  }
  lines.push('');

  return lines.join('\n');
}

module.exports = {
  runDoctor,
  formatDoctorReport,
};
