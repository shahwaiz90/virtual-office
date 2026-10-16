const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const { getAllSkills } = require('./officialSkills');
const { findAgentsConfigFile, findAllAgentsConfigFiles } = require('./agentDiscovery');
const { hasCanonicalRegistry, loadRegistry, ensureCanonicalDefinitions } = require('./registry/canonicalRegistry');
const { getAdapter } = require('./adapters');
const { rolePrompt } = require('./adapters/rolePrompt');

/**
 * Agent Runtime Registry & Auto-Discovery Hook for AI Agent Virtual Office
 * 
 * 1. Auto-Discovery & Registration: Parses .agents/agents.json and creates runtime registrations
 *    mapping id -> name, role/description -> system prompt, allowed_tools -> tool permissions,
 *    and skills -> associated skill documents.
 * 2. Discovery files: AGENTS.md, the team rule and the runtime manifest are written by the provider
 *    adapters (server/adapters), the same generators `node bin/agents.js sync` uses.
 */

/**
 * The system prompt for a registered role: the same text the adapters compile into
 * .agents/runtime-manifest.json (Antigravity/OpenCode roles start their delegates themselves).
 */
function buildEnforcedSystemPrompt(agent, allAgents, skillsMap, projectRoot, primaryAgent, teamName) {
  const registry = {
    name: teamName || path.basename(projectRoot || process.cwd()),
    orchestrator: primaryAgent ? primaryAgent.id : undefined,
    agents: allAgents,
  };
  const skillIds = agent.skillIds || (agent.skills || []).map((s) => (typeof s === 'string' ? s : s.id || s.name));
  return rolePrompt({ ...agent, skillIds }, registry, { dispatch: 'invoke_subagent' });
}

/**
 * Discovers and parses .agents/agents.json, registering each agent with full runtime metadata
 */
function parseAndRegisterAgents(projectRoot) {
  if (!projectRoot || !fs.existsSync(projectRoot)) {
    return null;
  }

  // 1. Check Canonical Registry first (Single Source of Truth)
  if (hasCanonicalRegistry(projectRoot)) {
    try {
      const canonical = loadRegistry(projectRoot);
      if (canonical && Array.isArray(canonical.agents) && canonical.agents.length > 0) {
        const allSkills = getAllSkills(projectRoot);
        const orchestratorId = canonical.orchestrator || canonical.agents[0].id;
        const primaryAgent = canonical.agents.find((a) => a.id === orchestratorId) || canonical.agents[0];

        const registeredAgents = canonical.agents.map((ag) => {
          const isPrimary = ag.id === orchestratorId || Boolean(ag.is_primary);
          let allowed = ag.tools || ag.allowed_tools || ag.allowedTools || ['view_file'];

          if (isPrimary) {
            const toolSet = new Set(allowed);
            toolSet.add('invoke_subagent');
            toolSet.add('send_message');
            toolSet.add('view_file');
            allowed = Array.from(toolSet);
          }

          const canSubagent = isPrimary || allowed.includes('invoke_subagent') || allowed.includes('define_subagent') || ag.enable_subagent_tools === true;
          const canWrite = allowed.some((t) => ['write_to_file', 'replace_file_content', 'run_command', 'git_diff'].includes(t)) || ag.enable_write_tools === true;
          const canMcp = ag.enable_mcp_tools === true;
          const handoff = ag.handoffTo || ag.delegation_targets || ag.delegationTargets || [];

          const mappedSkills = (ag.skills || ag.skillIds || []).map((skId) => {
            const sId = typeof skId === 'string' ? skId : skId.id || skId.name;
            const meta = allSkills[sId];
            return {
              id: sId,
              name: meta ? meta.name || meta.title || sId : sId,
              description: meta ? meta.description : `Project skill: ${sId}`,
              path: meta && meta.path ? meta.path : `.agents/skills/${sId}/SKILL.md`,
              category: meta ? meta.category : 'general',
              onDisk: meta ? Boolean(meta.onDisk) : false,
            };
          });

          const normalizedAgent = {
            id: ag.id,
            name: ag.name || ag.id,
            role: ag.role || (isPrimary ? 'Primary Orchestrator' : 'Specialist'),
            persona: ag.persona || '',
            goal: ag.goal || '',
            badge: ag.badge || (isPrimary ? 'PM' : (ag.name || ag.id).slice(0, 3).toUpperCase()),
            avatar_url: ag.avatar_url || ag.avatarUrl || (isPrimary ? '/assets/projectmanager.png' : '/assets/developer.png'),
            description: ag.description || (isPrimary ? 'Primary Orchestrator for project intake and delegation.' : `Subagent responsible for ${ag.role || 'engineering tasks'}`),
            skills: mappedSkills,
            skillIds: (ag.skills || ag.skillIds || []).map((s) => (typeof s === 'string' ? s : s.id || s.name)),
            tools: allowed,
            allowed_tools: allowed,
            enable_subagent_tools: canSubagent,
            enable_write_tools: canWrite,
            enable_mcp_tools: canMcp,
            inputContract: ag.inputContract || '',
            outputContract: ag.outputContract || '',
            permissions: ag.permissions || [],
            prohibited_actions: ag.prohibited_actions || ag.prohibitedActions || [],
            reportsTo: ag.reportsTo || (isPrimary ? 'user' : orchestratorId),
            handoffTo: handoff,
            delegation_targets: handoff,
            isPrimary,
            isSubagent: !isPrimary,
            parentAgent: isPrimary ? null : (ag.reportsTo || orchestratorId),
          };

          const systemPrompt = (ag.instructions && ag.instructions.trim().length > 50)
            ? ag.instructions.trim()
            : buildEnforcedSystemPrompt(normalizedAgent, canonical.agents, allSkills, projectRoot, primaryAgent, canonical.name);
          normalizedAgent.system_prompt = systemPrompt;

          normalizedAgent.registrationPayload = {
            name: normalizedAgent.id,
            description: `${normalizedAgent.name} (${normalizedAgent.role}${isPrimary ? ' - Primary Orchestrator' : ' - Subagent'}) - ${normalizedAgent.description}`,
            system_prompt: systemPrompt,
            enable_subagent_tools: canSubagent,
            enable_write_tools: canWrite,
            enable_mcp_tools: canMcp,
          };

          return normalizedAgent;
        });

        const orchestratorAgent = registeredAgents.find((a) => a.id === orchestratorId) || registeredAgents[0];

        return {
          registeredAt: new Date().toISOString(),
          projectRoot,
          configPath: path.join(projectRoot, '.agents', 'registry.yaml'),
          orchestratorAgentId: orchestratorId,
          orchestratorAgent,
          totalAgents: registeredAgents.length,
          agents: registeredAgents,
          canonical: true,
        };
      }
    } catch (err) {
      console.warn('[AgentRuntimeRegistry] Warning loading canonical registry, falling back to agents.json:', err.message);
    }
  }

  // 2. Legacy fallback to .agents/agents.json
  const configPath = findAgentsConfigFile(projectRoot);
  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    const rawAgents = parsed.agents || [];
    if (!Array.isArray(rawAgents) || rawAgents.length === 0) {
      return null;
    }

    const allSkills = getAllSkills(projectRoot);

    // Rule: The 1st agent is ALWAYS the Primary Orchestrator, and all other agents are its subagents!
    const primaryAgent = rawAgents[0];
    const orchestrator = primaryAgent;

    // Register each agent with mapped parameters
    const registeredAgents = rawAgents.map((ag, idx) => {
      const isPrimary = idx === 0;
      let allowed = ag.allowed_tools || ag.allowedTools || ['view_file'];

      if (isPrimary) {
        // Primary agent MUST always have invoke_subagent and send_message tools
        const toolSet = new Set(allowed);
        toolSet.add('invoke_subagent');
        toolSet.add('send_message');
        toolSet.add('view_file');
        allowed = Array.from(toolSet);
      }

      const canSubagent = isPrimary || allowed.includes('invoke_subagent') || allowed.includes('define_subagent') || ag.enable_subagent_tools === true;
      const canWrite = allowed.some((t) => ['write_to_file', 'replace_file_content', 'run_command', 'git_diff'].includes(t)) || ag.enable_write_tools === true;
      const canMcp = ag.enable_mcp_tools === true;

      // Map skills to full skill documents / metadata
      const mappedSkills = (ag.skills || ag.skillIds || []).map((skId) => {
        const sId = typeof skId === 'string' ? skId : skId.id || skId.name;
        const meta = allSkills[sId];
        return {
          id: sId,
          name: meta ? meta.name || meta.title || sId : sId,
          description: meta ? meta.description : `Project skill: ${sId}`,
          path: meta && meta.path ? meta.path : `.agents/skills/${sId}/SKILL.md`,
          category: meta ? meta.category : 'general',
          onDisk: meta ? Boolean(meta.onDisk) : false,
        };
      });

      const normalizedAgent = {
        id: ag.id || `agent-${idx + 1}`,
        name: ag.name || `Agent ${idx + 1}`,
        role: ag.role || (isPrimary ? 'Primary Orchestrator' : 'Specialist'),
        badge: ag.badge || (isPrimary ? 'PM' : (ag.name || 'AGT').slice(0, 3).toUpperCase()),
        avatar_url: ag.avatar_url || ag.avatarUrl || (isPrimary ? '/assets/projectmanager.png' : '/assets/developer.png'),
        description: ag.description || (isPrimary ? 'Primary Orchestrator for project intake and delegation.' : `Subagent responsible for ${ag.role || 'engineering tasks'}`),
        skills: mappedSkills,
        skillIds: (ag.skills || ag.skillIds || []).map((s) => (typeof s === 'string' ? s : s.id || s.name)),
        allowed_tools: allowed,
        enable_subagent_tools: canSubagent,
        enable_write_tools: canWrite,
        enable_mcp_tools: canMcp,
        prohibited_actions: ag.prohibited_actions || ag.prohibitedActions || [],
        delegation_targets: ag.delegation_targets || ag.delegationTargets || (isPrimary && rawAgents[1] ? [rawAgents[1].id] : []),
        isPrimary,
        isSubagent: !isPrimary,
        parentAgent: isPrimary ? null : primaryAgent.id,
      };

      // Generate the subagent system prompt with strict delegation enforcement
      const systemPrompt = buildEnforcedSystemPrompt(normalizedAgent, rawAgents, allSkills, projectRoot, primaryAgent);
      normalizedAgent.system_prompt = systemPrompt;

      // Define standard registration payload matching define_subagent schema
      normalizedAgent.registrationPayload = {
        name: normalizedAgent.id,
        description: `${normalizedAgent.name} (${normalizedAgent.role}${isPrimary ? ' - Primary Orchestrator' : ' - Subagent'}) - ${normalizedAgent.description}`,
        system_prompt: systemPrompt,
        enable_subagent_tools: canSubagent,
        enable_write_tools: canWrite,
        enable_mcp_tools: canMcp,
      };

      return normalizedAgent;
    });

    return {
      registeredAt: new Date().toISOString(),
      projectRoot,
      configPath,
      orchestratorAgentId: primaryAgent.id,
      orchestratorAgent: registeredAgents[0],
      totalAgents: registeredAgents.length,
      agents: registeredAgents,
    };
  } catch (err) {
    console.error(`[AgentRuntimeRegistry] Error registering agents from ${configPath}:`, err);
    return null;
  }
}

/**
 * Writes the team's discovery files (AGENTS.md, the always-on team rule, .agents/runtime-manifest.json)
 * with the OpenCode adapter, the same generator `node bin/agents.js sync` uses, so a server start never
 * rewrites them in another format. .agents/agents.json is left alone: here it is the user's input.
 */
function generateDiscoveryAnchor(projectRoot) {
  if (!hasCanonicalRegistry(projectRoot)) return false;
  const registry = loadRegistry(projectRoot);
  if (!registry || !Array.isArray(registry.agents) || registry.agents.length === 0) return false;
  getAdapter('opencode')
    .generate(registry, projectRoot, { keepAgentsJson: true })
    .then(() => linkGitRoot(projectRoot))
    .catch((err) => console.warn(`[AgentRuntimeRegistry] Could not write discovery files: ${err.message}`));
  return true;
}

/** When the project is a subfolder of a git repo, expose its .agents and AGENTS.md at the repo root. */
function linkGitRoot(projectRoot) {
  try {
    const gitRoot = child_process.execSync('git rev-parse --show-toplevel', { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!gitRoot || path.resolve(gitRoot) === path.resolve(projectRoot)) return;
    const gitAgentsLink = path.join(gitRoot, '.agents');
    if (!fs.existsSync(gitAgentsLink)) fs.symlinkSync(path.relative(gitRoot, path.join(projectRoot, '.agents')), gitAgentsLink, 'dir');
    const gitAgentsMd = path.join(gitRoot, 'AGENTS.md');
    const projectAgentsMd = path.join(projectRoot, 'AGENTS.md');
    if (!fs.existsSync(gitAgentsMd) && fs.existsSync(projectAgentsMd)) fs.copyFileSync(projectAgentsMd, gitAgentsMd);
  } catch (e) {
    // Not a git checkout
  }
}

/**
 * Main Auto-Discovery & Registration Hook
 * Invoked on Virtual Office initialization, workspace switch, or configuration save.
 */
function autoDiscoverAndRegisterAgents(projectRoot) {
  // Ensure canonical definitions exist (.agents/definitions/*.md)
  try {
    ensureCanonicalDefinitions(projectRoot);
  } catch (err) {
    console.warn(`[AgentRuntimeRegistry] ensureCanonicalDefinitions warning: ${err.message}`);
  }

  const registry = parseAndRegisterAgents(projectRoot);
  if (!registry) {
    return {
      success: false,
      message: `No .agents/agents.json configuration found in ${projectRoot}`,
      projectRoot,
      agents: [],
    };
  }

  // Discovery files (AGENTS.md, team rule, runtime manifest) come from the provider adapters
  generateDiscoveryAnchor(projectRoot);

  // Agents call the board at the address this server answers on (.agents/portal-url)
  require('./network').writePortalUrl(projectRoot);

  // Skills that run helper scripts (read-jira, read-confluence) need them in the project
  try {
    const { ensureSkillScripts } = require('./officialSkills');
    ensureSkillScripts(projectRoot, [...new Set(registry.agents.flatMap((a) => a.skillIds || []))]);
  } catch (e) {}

  console.info(`[AgentRuntimeRegistry] Auto-registered ${registry.totalAgents} agents for ${path.basename(projectRoot)}. Orchestrator: ${registry.orchestratorAgentId}`);

  return {
    success: true,
    message: `Successfully discovered and registered ${registry.totalAgents} agents for ${path.basename(projectRoot)}.`,
    registry,
  };
}

module.exports = {
  parseAndRegisterAgents,
  buildEnforcedSystemPrompt,
  generateDiscoveryAnchor,
  autoDiscoverAndRegisterAgents,
  ensureCanonicalDefinitions,
};
