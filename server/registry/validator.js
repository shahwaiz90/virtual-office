/**
 * Registry & Agent Validator
 *
 * Enforces schema integrity, tool permissions, skill path existence,
 * delegation target validity, and cyclic delegation graph checks.
 */

const fs = require('fs');
const path = require('path');

const VALID_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const KNOWN_TOOLS = new Set([
  'view_file',
  'write_to_file',
  'replace_file_content',
  'run_command',
  'git_diff',
  'invoke_subagent',
  'send_message',
  'schedule',
  'manage_task',
  'read_url_content',
  'search_web',
  'generate_image',
  'notebook_edit',
  'read_resource',
  'list_resources',
]);

/**
 * Detects cycles in a directed graph of agent delegation targets.
 * Returns array of detected cycles (paths).
 */
function findDelegationCycles(agents) {
  const adj = new Map();
  agents.forEach((ag) => {
    adj.set(ag.id, ag.handoffTo || ag.delegation_targets || []);
  });

  const visited = new Set();
  const recStack = new Set();
  const cycles = [];

  function dfs(node, path) {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    const neighbors = adj.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...path]);
      } else if (recStack.has(neighbor)) {
        // Cycle found
        const cycleStartIndex = path.indexOf(neighbor);
        const cyclePath = path.slice(cycleStartIndex).concat(neighbor);
        cycles.push(cyclePath);
      }
    }

    recStack.delete(node);
  }

  for (const agent of agents) {
    if (!visited.has(agent.id)) {
      dfs(agent.id, []);
    }
  }

  return cycles;
}

/**
 * Validates a loaded CanonicalRegistry object.
 *
 * @param {object} registry - The canonical registry object
 * @param {string} projectRoot - Path to the project root directory
 * @param {object} [options] - Optional validation flags { strict: boolean }
 * @returns {object} Validation result { valid, errors, warnings, stats }
 */
function validateRegistry(registry, projectRoot = process.cwd(), options = {}) {
  const errors = [];
  const warnings = [];

  if (!registry) {
    return {
      valid: false,
      errors: ['Registry is null or undefined.'],
      warnings: [],
      stats: { agentsCount: 0, skillsCount: 0 },
    };
  }

  const agents = registry.agents || [];
  if (!Array.isArray(agents) || agents.length === 0) {
    errors.push('Registry must define at least one agent in the team.');
    return {
      valid: false,
      errors,
      warnings,
      stats: { agentsCount: 0, skillsCount: 0 },
    };
  }

  // 1. Verify Orchestrator
  const orchestratorId = registry.orchestrator || (agents[0] && agents[0].id);
  const orchestratorAgent = agents.find((a) => a.id === orchestratorId);
  if (!orchestratorAgent) {
    errors.push(`Configured orchestrator ID "${orchestratorId}" does not exist in registered agents.`);
  }

  // 2. Map of existing agent IDs
  const agentIdSet = new Set();
  const duplicates = new Set();

  agents.forEach((ag) => {
    if (!ag.id) {
      errors.push(`Agent missing required "id" field: ${JSON.stringify(ag.name || ag)}`);
      return;
    }

    if (!VALID_ID_PATTERN.test(ag.id)) {
      errors.push(`Agent ID "${ag.id}" does not conform to kebab-case pattern /^[a-z0-9]+(-[a-z0-9]+)*$/`);
    }

    if (agentIdSet.has(ag.id)) {
      duplicates.add(ag.id);
    }
    agentIdSet.add(ag.id);

    if (!ag.name) {
      warnings.push(`Agent "${ag.id}" has no display name configured.`);
    }

    if (!ag.role) {
      warnings.push(`Agent "${ag.id}" has no role configured.`);
    }
  });

  if (duplicates.size > 0) {
    errors.push(`Duplicate agent IDs found: ${Array.from(duplicates).join(', ')}`);
  }

  // 3. Skills verification
  const skillsDir = path.join(projectRoot, registry.skills_dir || '.agents/skills');
  const diskSkills = new Set();
  if (fs.existsSync(skillsDir)) {
    try {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory()) {
          const skillDoc = path.join(skillsDir, ent.name, 'SKILL.md');
          if (fs.existsSync(skillDoc)) {
            diskSkills.add(ent.name);
          }
        }
      }
    } catch (e) {
      warnings.push(`Failed reading skills directory at ${skillsDir}: ${e.message}`);
    }
  }

  const referencedSkills = new Set();
  const missingSkills = new Set();

  // 4. Validate individual agents
  agents.forEach((ag) => {
    // Check delegation targets (handoffTo / delegation_targets)
    const delegationTargets = ag.handoffTo || ag.delegation_targets || [];
    delegationTargets.forEach((tgtId) => {
      if (!agentIdSet.has(tgtId)) {
        errors.push(`Agent "${ag.id}" delegates to non-existent agent "${tgtId}".`);
      }
      if (tgtId === ag.id) {
        errors.push(`Agent "${ag.id}" delegates to itself.`);
      }
    });

    // Check reportsTo
    if (ag.reportsTo !== undefined && ag.reportsTo !== null) {
      if (typeof ag.reportsTo === 'string') {
        const rep = ag.reportsTo.trim();
        if (rep && rep.toLowerCase() !== 'user' && rep.toLowerCase() !== 'none') {
          if (!agentIdSet.has(rep)) {
            errors.push(`Agent "${ag.id}" reports to non-existent agent "${rep}".`);
          }
          if (rep === ag.id) {
            errors.push(`Agent "${ag.id}" cannot report to itself.`);
          }
        }
      }
    }

    // Check allowed tools / tools
    const allowedTools = ag.tools || ag.allowed_tools || [];
    allowedTools.forEach((tool) => {
      if (!KNOWN_TOOLS.has(tool)) {
        warnings.push(`Agent "${ag.id}" specifies unknown/custom tool: "${tool}"`);
      }
    });

    // Tool permission consistency
    if (allowedTools.includes('invoke_subagent') && !ag.enable_subagent_tools && !ag.is_primary && ag.id !== orchestratorId) {
      warnings.push(`Agent "${ag.id}" has "invoke_subagent" in allowed_tools but "enable_subagent_tools" is false.`);
    }

    // Check skills
    const skills = ag.skills || [];
    skills.forEach((sk) => {
      const skillId = typeof sk === 'string' ? sk : sk.id;
      referencedSkills.add(skillId);
      if (fs.existsSync(skillsDir) && !diskSkills.has(skillId)) {
        missingSkills.add(skillId);
      }
    });
  });

  if (missingSkills.size > 0) {
    const list = Array.from(missingSkills).join(', ');
    if (options.strict) {
      errors.push(`Missing skill definitions on disk: ${list}`);
    } else {
      warnings.push(`Referenced skills without corresponding SKILL.md on disk: ${list}`);
    }
  }

  // Find orphan skills (on disk but not assigned to any agent)
  const orphanSkills = [];
  diskSkills.forEach((sk) => {
    if (!referencedSkills.has(sk)) {
      orphanSkills.push(sk);
    }
  });

  // 5. Detect cycles
  const cycles = findDelegationCycles(agents);
  if (cycles.length > 0) {
    const cycleDesc = cycles.map((c) => c.join(' -> ')).join(' | ');
    if (options.strict) {
      errors.push(`Cyclic delegation deadlocks detected: ${cycleDesc}`);
    } else {
      warnings.push(`Cyclic delegation paths detected: ${cycleDesc}`);
    }
  }

  // 6. The saved team (office desks) may only name roles in the catalog
  if (Array.isArray(registry.team)) {
    const unknown = registry.team.filter((id) => !agentIdSet.has(id));
    if (unknown.length > 0) {
      warnings.push(`Saved team lists roles with no definition (ignored): ${unknown.join(', ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      agentsCount: agents.length,
      skillsCount: referencedSkills.size,
      orphanSkills,
      missingSkills: Array.from(missingSkills),
      cyclesDetected: cycles,
    },
  };
}

module.exports = {
  validateRegistry,
  findDelegationCycles,
  VALID_ID_PATTERN,
  KNOWN_TOOLS,
};
