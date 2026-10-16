/**
 * OpenCode / Antigravity Provider Adapter
 *
 * Generates:
 * - AGENTS.md (Discovery Anchor & Team Orchestration Manual)
 * - .agents/rules/team-orchestration.md (Workspace always-on rule)
 * - .agents/runtime-manifest.json (Pre-compiled subagent payloads)
 * - .agents/agents.json (Synchronized for backward compatibility)
 */

const path = require('path');
const BaseAdapter = require('./baseAdapter');

class OpenCodeAdapter extends BaseAdapter {
  constructor() {
    super('opencode', 'OpenCode & Antigravity runtime adapter');
    this.targetFiles = [
      'AGENTS.md',
      path.join('.agents', 'rules', 'team-orchestration.md'),
      path.join('.agents', 'runtime-manifest.json'),
      path.join('.agents', 'agents.json'),
    ];
  }

  buildMermaidDiagram(agents) {
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
      (ag.handoffTo || ag.delegation_targets || []).forEach((tgtId) => {
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

  buildSystemPrompt(agent, allAgents, projectRoot, orchestrator) {
    // If agent already has custom instructions in markdown body, use them as base
    if (agent.instructions && agent.instructions.trim().length > 50) {
      return agent.instructions.trim();
    }

    const isPrimary = agent.id === orchestrator.id || Boolean(agent.is_primary);
    const delegationTargets = agent.handoffTo || agent.delegation_targets || [];
    const targetAgentObjs = allAgents.filter((a) => delegationTargets.includes(a.id));
    const prohibitedActions = agent.prohibited_actions || [];

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
      lines.push(`# Identity & Role: ${agent.name} (\`${agent.id}\`) - SUBAGENT`);
      lines.push(`You are **${agent.name}** (\`${agent.id}\`), serving as **${agent.role}**, a specialized subagent operating under the Primary Orchestrator **${orchestrator.name}** (\`${orchestrator.id}\`).`);
      lines.push(``);
      lines.push(`## Role Description & Responsibilities`);
      lines.push(`${agent.description || `Responsible for ${agent.role} deliverables.`}`);
    }
    lines.push(``);

    // Tool capabilities
    lines.push(`## Tool Capabilities & Permissions`);
    const tools = agent.tools || agent.allowed_tools || [];
    if (tools.length > 0) {
      lines.push(`You are authorized to use the following tools:`);
      tools.forEach((tool) => {
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

    // Subagent Delegation Protocol
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
    } else if (agent.enable_subagent_tools && delegationTargets.length > 0) {
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
      lines.push(`You are a specialized leaf subagent and do NOT have subagent delegation authority.`);
      lines.push(`- Do NOT attempt to call \`invoke_subagent\` or \`define_subagent\`.`);
      if (delegationTargets.length > 0) {
        lines.push(`- Upon task completion, report your findings, modified code, diffs, and verification test logs back to: **${delegationTargets.join(', ')}**.`);
      } else {
        lines.push(`- Upon task completion, report your findings, modified code, diffs, and verification test logs back to Primary Orchestrator **${orchestrator.name}** (\`${orchestrator.id}\`).`);
      }
    }
    lines.push(``);

    // Skills
    const skillIds = agent.skillIds || [];
    if (skillIds.length > 0) {
      lines.push(`## Assigned Specialized Skills`);
      lines.push(`You have been assigned the following domain skills located in \`.agents/skills/\`:`);
      skillIds.forEach((skId) => {
        lines.push(`- **\`${skId}\`**: (Read instructions from [\`.agents/skills/${skId}/SKILL.md\`](file://${path.join(projectRoot, '.agents', 'skills', skId, 'SKILL.md')}))`);
      });
      lines.push(``);
      lines.push(`Before executing actions related to these domains, read the corresponding \`SKILL.md\` file to follow required standards.`);
    }

    return lines.join('\n');
  }

  async generate(registry, projectRoot, options = {}) {
    const filesWritten = [];
    const warnings = [];

    const agents = registry.agents || [];
    if (agents.length === 0) {
      return { success: false, filesWritten: [], warnings: ['No agents in registry'] };
    }

    const orchestratorId = registry.orchestrator || agents[0].id;
    const orchestrator = agents.find((a) => a.id === orchestratorId) || agents[0];
    const projectName = registry.name || path.basename(projectRoot);

    // 1. Generate AGENTS.md
    const mermaidDiagram = this.buildMermaidDiagram(agents);
    const agentsMdContent = `# Multi-Agent Team Orchestration for ${projectName}

This project is configured with a specialized Virtual Office Multi-Agent Team defined in [\`.agents/registry.yaml\`](file://${path.join(projectRoot, '.agents', 'registry.yaml')}).

> [!IMPORTANT]
> ### 🎯 ALWAYS INVOKE \`${orchestrator.id}\` FIRST (PRIMARY ORCHESTRATOR)!
> **The primary agent in the active roster (\`${orchestrator.id}\`) is the Primary Orchestrator.**
> All other agents (${agents.filter((a) => a.id !== orchestrator.id).map((a) => `\`${a.id}\``).join(', ')}) operate as its specialized subagents.
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
    (ag) =>
      `| **\`${ag.id}\`** | ${ag.id === orchestrator.id ? '**👑 Primary Orchestrator**' : '*Subagent (Tier 2)*'} | ${ag.name} | *${ag.role}* | \`${(ag.tools || ag.allowed_tools || []).join(', ')}\` | ${(ag.handoffTo || ag.delegation_targets || []).map((t) => `\`${t}\``).join(', ') || '*None*'} | \`${ag.enable_subagent_tools ? 'true' : 'false'}\` |`
  )
  .join('\n')}

---

## Detailed Agent Profiles & Assigned Skills

${agents
  .map((ag) => {
    const isOrch = ag.id === orchestrator.id;
    const skillsList = (ag.skillIds || []).map((skId) => `[\`${skId}\`](file://${path.join(projectRoot, '.agents', 'skills', skId, 'SKILL.md')})`).join(', ') || '*None*';
    const prohibitedList = (ag.prohibited_actions || []).map((p) => `*${p}*`).join(', ') || '*None*';
    const delegationList = (ag.handoffTo || ag.delegation_targets || []).map((t) => `\`${t}\``).join(', ') || (isOrch ? '*All team subagents*' : '*Leaf Specialist (Reports back to lead)*');
    const permissionsList = (ag.permissions && ag.permissions.length > 0) ? ag.permissions.map((p) => `\`${p}\``).join(', ') : '*Standard permissions*';

    return `### ${isOrch ? '👑' : '🧩'} **\`${ag.id}\`** (${ag.name} - *${ag.role}*) ${isOrch ? '- **[PRIMARY ORCHESTRATOR]**' : `- *[SUBAGENT of \`${orchestrator.id}\`]*`}
- **Description:** ${ag.description || ag.role}
- **Persona:** ${ag.persona || 'Specialist'}
- **Goal:** ${ag.goal || 'Deliver sprint requirements'}
- **Hierarchy:** ${isOrch ? 'Top-Level Orchestrator (Receives user requests first)' : `Subagent reporting to \`${ag.reportsTo || orchestrator.id}\``}
- **Reports To:** \`${ag.reportsTo || (isOrch ? 'user' : orchestrator.id)}\`
- **Tool Access:** \`${(ag.tools || ag.allowed_tools || []).join(', ')}\`
- **Assigned Skills:** ${skillsList}
- **Input Contract:** ${ag.inputContract || '*Sprint task instructions*'}
- **Output Contract:** ${ag.outputContract || '*Deliverable status report and code artifacts*'}
- **Permissions:** ${permissionsList}
- **Prohibited Actions:** ${prohibitedList}
- **Delegation Targets:** ${delegationList}
`;
  })
  .join('\n')}

---

## Antigravity Subagent Registration Guide

When defining agents in this project via \`define_subagent\`:
- **Top-Level Orchestrator (\`${orchestrator.id}\`):** Set \`enable_subagent_tools: true\` and \`enable_write_tools: true\`.
- **Architects / Leads (\`enable_subagent_tools: true\`):** Required so they can invoke subagents to delegate.
- **Specialists / QA:** Set \`enable_write_tools: true\` so they can edit files and execute test commands.
- Pre-compiled registration payloads are cached in [\`.agents/runtime-manifest.json\`](file://${path.join(projectRoot, '.agents', 'runtime-manifest.json')}).
`;

    filesWritten.push(this.writeFileSafely(path.join(projectRoot, 'AGENTS.md'), agentsMdContent, options));

    // 2. Generate .agents/rules/team-orchestration.md
    const ruleContent = `---
name: team-orchestration
description: Guidelines for invoking and orchestrating the multi-agent team in this project.
always_on: true
---

# Multi-Agent Team Orchestration Rule

When responding to software requests in this repository:
1. Consult \`.agents/registry.yaml\` or \`.agents/definitions/\` for agent profiles, assigned skills, and delegation targets.
2. **Always invoke \`${orchestrator.id}\` (${orchestrator.name}) first** to decompose the user goal into a 4-stage sprint plan (Architecture Spike -> Feature Implementation -> Code Review -> QA Acceptance Verification).
3. When registering subagents with \`define_subagent\`:
   - Set \`enable_subagent_tools: true\` for leads and orchestrators that delegate via \`invoke_subagent\`.
   - Set \`enable_write_tools: true\` for developers and QA engineers.
4. Each subagent must strictly observe their permitted \`delegation_targets\` and prohibited actions.
`;

    filesWritten.push(this.writeFileSafely(path.join(projectRoot, '.agents', 'rules', 'team-orchestration.md'), ruleContent, options));

    // 3. Generate pre-compiled runtime manifest
    const runtimeAgents = agents.map((ag) => {
      const isPrimary = ag.id === orchestrator.id || Boolean(ag.is_primary);
      const prompt = this.buildSystemPrompt(ag, agents, projectRoot, orchestrator);
      const tools = ag.tools || ag.allowed_tools || ['view_file'];
      const handoff = ag.handoffTo || ag.delegation_targets || [];
      return {
        id: ag.id,
        name: ag.name,
        role: ag.role,
        persona: ag.persona || '',
        goal: ag.goal || '',
        badge: ag.badge || ag.id.slice(0, 3).toUpperCase(),
        avatar_url: ag.avatar_url || '/assets/developer.png',
        description: ag.description || ag.role,
        skills: (ag.skillIds || []).map((skId) => ({
          id: skId,
          name: skId,
          description: `Skill: ${skId}`,
          path: `.agents/skills/${skId}/SKILL.md`,
        })),
        skillIds: ag.skillIds || [],
        tools,
        allowed_tools: tools,
        enable_subagent_tools: Boolean(ag.enable_subagent_tools),
        enable_write_tools: Boolean(ag.enable_write_tools),
        enable_mcp_tools: Boolean(ag.enable_mcp_tools),
        inputContract: ag.inputContract || '',
        outputContract: ag.outputContract || '',
        permissions: ag.permissions || [],
        prohibited_actions: ag.prohibited_actions || [],
        reportsTo: ag.reportsTo || (isPrimary ? 'user' : orchestrator.id),
        handoffTo: handoff,
        delegation_targets: handoff,
        isPrimary,
        isSubagent: !isPrimary,
        parentAgent: isPrimary ? null : (ag.reportsTo || orchestrator.id),
        system_prompt: prompt,
        registrationPayload: {
          name: ag.id,
          description: `${ag.name} (${ag.role}${isPrimary ? ' - Primary Orchestrator' : ' - Subagent'}) - ${ag.description || ag.role}`,
          system_prompt: prompt,
          enable_subagent_tools: Boolean(ag.enable_subagent_tools),
          enable_write_tools: Boolean(ag.enable_write_tools),
          enable_mcp_tools: Boolean(ag.enable_mcp_tools),
        },
      };
    });

    const runtimeManifest = {
      registeredAt: new Date().toISOString(),
      projectRoot,
      orchestratorAgentId: orchestrator.id,
      orchestratorAgent: runtimeAgents.find((a) => a.id === orchestrator.id) || runtimeAgents[0],
      totalAgents: runtimeAgents.length,
      agents: runtimeAgents,
    };

    filesWritten.push(
      this.writeFileSafely(path.join(projectRoot, '.agents', 'runtime-manifest.json'), JSON.stringify(runtimeManifest, null, 2), options)
    );

    // 4. Synchronize .agents/agents.json for 100% backward compatibility
    const legacyAgentsJson = {
      $schema: 'https://raw.githubusercontent.com/google/virtual-office/main/agents-schema.json',
      version: '1.0.0',
      description: registry.description || `Virtual Office Multi-Agent Team for ${projectName}`,
      agents: agents.map((ag) => {
        const tools = ag.tools || ag.allowed_tools || ['view_file'];
        const handoff = ag.handoffTo || ag.delegation_targets || [];
        return {
          id: ag.id,
          name: ag.name,
          role: ag.role,
          persona: ag.persona || '',
          goal: ag.goal || '',
          badge: ag.badge || ag.id.slice(0, 3).toUpperCase(),
          avatar_url: ag.avatar_url || '/assets/developer.png',
          description: ag.description || '',
          skills: ag.skillIds || [],
          tools,
          allowed_tools: tools,
          enable_subagent_tools: Boolean(ag.enable_subagent_tools),
          enable_write_tools: Boolean(ag.enable_write_tools),
          enable_mcp_tools: Boolean(ag.enable_mcp_tools),
          inputContract: ag.inputContract || '',
          outputContract: ag.outputContract || '',
          permissions: ag.permissions || [],
          prohibited_actions: ag.prohibited_actions || [],
          reportsTo: ag.reportsTo || (ag.id === orchestrator.id ? 'user' : orchestrator.id),
          handoffTo: handoff,
          delegation_targets: handoff,
        };
      }),
    };

    filesWritten.push(
      this.writeFileSafely(path.join(projectRoot, '.agents', 'agents.json'), JSON.stringify(legacyAgentsJson, null, 2), options)
    );

    return {
      success: true,
      filesWritten,
      warnings,
    };
  }
}

module.exports = OpenCodeAdapter;
