const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const { getAllSkills } = require('./officialSkills');
const { findAgentsConfigFile, findAllAgentsConfigFiles } = require('./agentDiscovery');
const { hasCanonicalRegistry, loadRegistry, ensureCanonicalDefinitions } = require('./registry/canonicalRegistry');

/**
 * Agent Runtime Registry & Auto-Discovery Hook for AI Agent Virtual Office
 * 
 * 1. Auto-Discovery & Registration: Parses .agents/agents.json and creates runtime registrations
 *    mapping id -> name, role/description -> system prompt, allowed_tools -> tool permissions,
 *    and skills -> associated skill documents.
 * 2. Auto-Generate Discovery Anchor (AGENTS.md): Writes/updates AGENTS.md and team-orchestration.md rule,
 *    summarizing active roster, delegation graph, and explicit instructions that the top-level orchestrator
 *    (e.g., android-pm) must be invoked first.
 * 3. Subagent Delegation Enforcer: Ensures generated system prompts explicitly instruct each subagent
 *    about who they are strictly permitted to invoke according to delegation_targets.
 */

/**
 * Builds the enforced system prompt for a registered subagent
 */
function buildEnforcedSystemPrompt(agent, allAgents, skillsMap, projectRoot, primaryAgent) {
  const isPrimary = agent.isPrimary === true;
  const isOrchestrator = isPrimary || (agent.allowed_tools || []).includes('invoke_subagent') || (agent.enable_subagent_tools === true);
  const delegationTargets = agent.delegation_targets || agent.delegationTargets || [];
  const targetAgentObjs = allAgents.filter((a) => delegationTargets.includes(a.id));
  const prohibitedActions = agent.prohibited_actions || agent.prohibitedActions || [];

  // Skill descriptions mapped to agent
  const agentSkills = (agent.skills || []).map((skId) => {
    const sId = typeof skId === 'string' ? skId : skId.id || skId.name;
    const meta = skillsMap[sId];
    return {
      id: sId,
      name: meta ? meta.name || meta.title || sId : sId,
      description: meta ? meta.description : `Skill for ${sId}`,
      path: `.agents/skills/${sId}/SKILL.md`,
    };
  });

  const lines = [];

  if (isPrimary) {
    lines.push(`# Identity & Role: ${agent.name} (\`${agent.id}\`) - PRIMARY ORCHESTRATOR`);
    lines.push(`You are **${agent.name}** (\`${agent.id}\`), serving as the **Primary Orchestrator & Top-Level Agent** for this project workspace.`);
    lines.push(`All other agents in this team are your subagents.`);
    lines.push(``);
    lines.push(`## Primary Orchestration Directives`);
    lines.push(`1. **Intake & Triage**: When user requests arrive, you MUST receive them first and analyze requirements.`);
    lines.push(`2. **No Monolithic Execution**: Do NOT write application implementation code directly. Always deconstruct requests into sprint tasks.`);
    lines.push(`3. **Subagent Delegation**: Delegate tasks to your designated subagents via \`invoke_subagent\` following the team delegation graph.`);
  } else {
    const primaryName = primaryAgent ? primaryAgent.name : 'Primary Orchestrator';
    const primaryId = primaryAgent ? primaryAgent.id : 'orchestrator';
    lines.push(`# Identity & Role: ${agent.name} (\`${agent.id}\`) - SUBAGENT`);
    lines.push(`You are **${agent.name}** (\`${agent.id}\`), serving as **${agent.role}**, a specialized subagent operating under the Primary Orchestrator **${primaryName}** (\`${primaryId}\`).`);
    lines.push(``);
    lines.push(`## Role Description & Responsibilities`);
    lines.push(`${agent.description || `Responsible for ${agent.role} deliverables.`}`);
  }
  lines.push(``);

  // Tool permissions and write access
  lines.push(`## Tool Capabilities & Permissions`);
  if (agent.allowed_tools && agent.allowed_tools.length > 0) {
    lines.push(`You are authorized to use the following tools:`);
    agent.allowed_tools.forEach((tool) => {
      lines.push(`- \`${tool}\``);
    });
  } else {
    lines.push(`- Read-only tools (\`view_file\`)`);
  }
  lines.push(``);

  // Prohibited actions
  if (prohibitedActions.length > 0) {
    lines.push(`## Prohibited Actions (Strict Guardrails)`);
    prohibitedActions.forEach((act) => {
      lines.push(`- 🚫 **${act}**`);
    });
    lines.push(``);
  }

  // Subagent Delegation Enforcer
  lines.push(`## Subagent Delegation Protocol (Strict Enforcer)`);
  if (isPrimary) {
    lines.push(`As the Primary Orchestrator, you have top-level subagent delegation authority via \`invoke_subagent\`.`);
    lines.push(`> [!IMPORTANT]`);
    lines.push(`> **Permitted Subagents:** You are authorized to delegate to your team subagents:`);
    const validTargets = targetAgentObjs.length > 0 ? targetAgentObjs : allAgents.filter((a) => a.id !== agent.id);
    validTargets.forEach((tgt) => {
      lines.push(`> - **\`${tgt.id}\`** (${tgt.name} - *${tgt.role}*)`);
    });
    lines.push(``);
    lines.push(`When delegating tasks to subagents via \`invoke_subagent\`, use this schema:`);
    lines.push(`\`\`\`json`);
    lines.push(`{`);
    lines.push(`  "TypeName": "<subagent-id>",`);
    lines.push(`  "Role": "<subagent-role>",`);
    lines.push(`  "Prompt": "Detailed actionable task instructions with acceptance criteria.",`);
    lines.push(`  "Model": "inherit",`);
    lines.push(`  "Workspace": "inherit"`);
    lines.push(`}`);
    lines.push(`\`\`\``);
  } else if (isOrchestrator && delegationTargets.length > 0) {
    lines.push(`You are a lead subagent with delegation authority via \`invoke_subagent\`.`);
    lines.push(`> [!IMPORTANT]`);
    lines.push(`> **Permitted Delegation Targets:** You are strictly authorized to invoke ONLY the following subagents:`);
    targetAgentObjs.forEach((tgt) => {
      lines.push(`> - **\`${tgt.id}\`** (${tgt.name} - *${tgt.role}*)`);
    });
    lines.push(`> Delegating to any agent outside this whitelist is strictly prohibited.`);
    lines.push(``);
    lines.push(`When invoking a subagent, use \`invoke_subagent\` specifying Model: 'inherit', Workspace: 'inherit'.`);
  } else {
    const primaryName = primaryAgent ? primaryAgent.name : 'Primary Orchestrator';
    const primaryId = primaryAgent ? primaryAgent.id : 'orchestrator';
    lines.push(`You are a specialized leaf subagent and do NOT have subagent delegation authority.`);
    lines.push(`- Do NOT attempt to call \`invoke_subagent\` or \`define_subagent\`.`);
    if (delegationTargets.length > 0) {
      lines.push(`- Upon task completion, report your findings, modified code, diffs, and verification test logs back to: **${delegationTargets.join(', ')}**.`);
    } else {
      lines.push(`- Upon task completion, report your findings, modified code, diffs, and verification test logs back to Primary Orchestrator **${primaryName}** (\`${primaryId}\`).`);
    }
  }
  lines.push(``);

  // Skills section
  if (agentSkills.length > 0) {
    lines.push(`## Assigned Specialized Skills`);
    lines.push(`You have been assigned the following domain skills located in \`.agents/skills/\`:`);
    agentSkills.forEach((sk) => {
      lines.push(`- **\`${sk.id}\`**: ${sk.description} (Read instructions from [\`${sk.path}\`](file://${path.join(projectRoot, sk.path)}))`);
    });
    lines.push(``);
    lines.push(`Before executing actions related to these domains, read the corresponding \`SKILL.md\` file to follow required standards.`);
  }

  return lines.join('\n');
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
            : buildEnforcedSystemPrompt(normalizedAgent, canonical.agents, allSkills, projectRoot, primaryAgent);
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
 * Builds the visual Mermaid diagram for the team delegation graph
 */
function buildDelegationDiagram(agents) {
  const lines = ['flowchart TD'];
  const primary = agents[0];
  if (primary) {
    lines.push(`  ${primary.id}["👑 ${primary.name}<br/><b>PRIMARY ORCHESTRATOR</b><br/><i>${primary.role}</i>"]:::primaryStyle`);
  }
  agents.slice(1).forEach((ag) => {
    lines.push(`  ${ag.id}["${ag.name}<br/><i>${ag.role}</i> (Subagent)"]`);
  });
  lines.push('');
  agents.forEach((ag) => {
    (ag.delegation_targets || []).forEach((tgtId) => {
      const tgt = agents.find((a) => a.id === tgtId);
      if (tgt) {
        lines.push(`  ${ag.id} -->|delegates to| ${tgt.id}`);
      }
    });
  });
  lines.push('');
  lines.push('  classDef primaryStyle fill:#eef2ff,stroke:#4f46e5,stroke-width:2px,color:#1e1b4b;');
  return lines.join('\n');
}

/**
 * Generates and writes AGENTS.md (Discovery Anchor) & .agents/rules/team-orchestration.md
 */
function generateDiscoveryAnchor(projectRoot, registry) {
  if (!projectRoot || !registry || !registry.agents) return false;

  const agents = registry.agents;
  const orchestrator = registry.orchestratorAgent || agents[0];
  const projectName = path.basename(projectRoot);

  const mermaidDiagram = buildDelegationDiagram(agents);

  const agentsMdContent = `# Multi-Agent Team Orchestration for ${projectName}

This project is configured with a specialized Virtual Office Multi-Agent Team defined in [\`.agents/agents.json\`](file://${path.join(projectRoot, '.agents', 'agents.json')}).

> [!IMPORTANT]
> ### 🎯 ALWAYS INVOKE \`${orchestrator.id}\` FIRST (PRIMARY ORCHESTRATOR)!
> **The 1st agent in the active roster (\`${orchestrator.id}\`) is the Primary Orchestrator.**
> All other agents (${agents.slice(1).map((a) => `\`${a.id}\``).join(', ')}) operate as its specialized subagents.
> When a user request arrives (feature development, architecture, testing, or bug fixes):
> 1. **Do not begin executing tasks directly as a single monolithic agent.**
> 2. **Invoke \`${orchestrator.id}\` (${orchestrator.name}) first** as the Primary Orchestrator using \`invoke_subagent\`.
> 3. **\`${orchestrator.id}\`** breaks down the user request into structured sprint tasks with clear acceptance criteria following [\`task-decomposition\`](file://${path.join(projectRoot, '.agents', 'skills', 'task-decomposition', 'SKILL.md')}), and delegates to its subagents according to the delegation graph below.

---

## Delegation Graph & Workflow

\`\`\`mermaid
${mermaidDiagram}
\`\`\`

---

## Active Team Roster

| Agent ID | Hierarchy | Name | Role | Allowed Tools | Delegation Targets | Subagent Tools |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${agents
  .map(
    (ag, idx) =>
      `| **\`${ag.id}\`** | ${idx === 0 ? '**👑 Primary Orchestrator**' : '*Subagent (Tier 2)*'} | ${ag.name} | *${ag.role}* | \`${ag.allowed_tools.join(', ')}\` | ${ag.delegation_targets.map((t) => `\`${t}\``).join(', ') || '*None*'} | \`${ag.enable_subagent_tools ? 'true' : 'false'}\` |`
  )
  .join('\n')}

---

## Detailed Agent Profiles & Assigned Skills

${agents
  .map(
    (ag, idx) => `### ${idx === 0 ? '👑' : '🧩'} **\`${ag.id}\`** (${ag.name} - *${ag.role}*) ${idx === 0 ? '- **[PRIMARY ORCHESTRATOR]**' : `- *[SUBAGENT of \`${orchestrator.id}\`]*`}
- **Description:** ${ag.description}
- **Hierarchy:** ${idx === 0 ? 'Top-Level Orchestrator (Receives user requests first)' : `Subagent reporting to \`${orchestrator.id}\``}
- **Tool Access:** \`${ag.allowed_tools.join(', ')}\`
- **Assigned Skills:** ${ag.skills.map((s) => `[\`${s.id}\`](file://${path.join(projectRoot, s.path)})`).join(', ') || '*None*'}
- **Prohibited Actions:** ${ag.prohibited_actions.map((p) => `*${p}*`).join(', ') || '*None*'}
- **Delegation Targets:** ${ag.delegation_targets.map((t) => `\`${t}\``).join(', ') || (idx === 0 ? '*All team subagents*' : '*Leaf Specialist (Reports back to lead)*')}
`
  )
  .join('\n')}

---

## Antigravity Subagent Registration Guide

When defining agents in this project via \`define_subagent\`:
- **Top-Level Orchestrator (\`${orchestrator.id}\`):** Set \`enable_subagent_tools: true\` and \`enable_write_tools: true\`.
- **Architects / Leads (\`enable_subagent_tools: true\`):** Required so they can invoke subagents to delegate.
- **Specialists / QA:** Set \`enable_write_tools: true\` so they can edit files and execute test commands.
- Pre-compiled registration payloads are cached in [\`.agents/runtime-manifest.json\`](file://${path.join(projectRoot, '.agents', 'runtime-manifest.json')}).
`;

  // Write AGENTS.md
  const agentsMdPath = path.join(projectRoot, 'AGENTS.md');
  fs.writeFileSync(agentsMdPath, agentsMdContent, 'utf8');

  // Write Workspace Rule: .agents/rules/team-orchestration.md
  const rulesDir = path.join(projectRoot, '.agents', 'rules');
  if (!fs.existsSync(rulesDir)) {
    fs.mkdirSync(rulesDir, { recursive: true });
  }
  const rulePath = path.join(rulesDir, 'team-orchestration.md');
  const ruleContent = `---
name: team-orchestration
description: Guidelines for invoking and orchestrating the multi-agent team in this project.
always_on: true
---

# Multi-Agent Team Orchestration Rule

When responding to software requests in this repository:
1. Consult \`.agents/agents.json\` for agent profiles, assigned skills, and delegation targets.
2. **Always invoke \`${orchestrator.id}\` (${orchestrator.name}) first** to break the user's requirement into the specific tasks it needs (no fixed template or task count), register them on the Kanban board, then delegate each one (see the \`task-decomposition\` skill).
3. When registering subagents with \`define_subagent\`:
   - Set \`enable_subagent_tools: true\` for leads and orchestrators that delegate via \`invoke_subagent\`.
   - Set \`enable_write_tools: true\` for developers and QA engineers.
4. Each subagent must strictly observe their permitted \`delegation_targets\` and prohibited actions.
`;
  fs.writeFileSync(rulePath, ruleContent, 'utf8');

  // Write pre-compiled runtime registration manifest for automatic loaders
  const manifestPath = path.join(projectRoot, '.agents', 'runtime-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(registry, null, 2), 'utf8');

  // Synchronize with Git repository root if projectRoot is inside a subfolder
  try {
    const gitRoot = child_process.execSync('git rev-parse --show-toplevel', { cwd: projectRoot, encoding: 'utf8' }).trim();
    if (gitRoot && gitRoot !== projectRoot && fs.existsSync(gitRoot)) {
      const gitAgentsLink = path.join(gitRoot, '.agents');
      if (!fs.existsSync(gitAgentsLink)) {
        const rel = path.relative(gitRoot, path.join(projectRoot, '.agents'));
        fs.symlinkSync(rel, gitAgentsLink, 'dir');
      }
      const gitAgentsMd = path.join(gitRoot, 'AGENTS.md');
      if (!fs.existsSync(gitAgentsMd)) {
        fs.writeFileSync(gitAgentsMd, agentsMdContent, 'utf8');
      }
    }
  } catch (gitErr) {
    // Non-git environment fallback
  }

  return true;
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

  // Auto-generate Discovery Anchor (AGENTS.md) and rules
  generateDiscoveryAnchor(projectRoot, registry);

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
