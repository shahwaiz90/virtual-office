/**
 * Claude Code Provider Adapter
 *
 * Generates:
 * - CLAUDE.md (Claude Code project instruction manual & orchestration guide)
 * - .claude/config.json (Project-level tool permissions & agent configurations)
 */

const path = require('path');
const BaseAdapter = require('./baseAdapter');

class ClaudeAdapter extends BaseAdapter {
  constructor() {
    super('claude', 'Claude Code multi-agent adapter');
    this.targetFiles = [
      'CLAUDE.md',
      path.join('.claude', 'config.json'),
    ];
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

    // 1. Generate CLAUDE.md
    const claudeMdLines = [
      `# Claude Code Guidelines & Multi-Agent Team: ${projectName}`,
      ``,
      `> [!IMPORTANT]`,
      `> ### 🎯 PRIMARY ORCHESTRATOR ROUTING: \`${orchestrator.id}\``,
      `> **Always route incoming software engineering requests to \`${orchestrator.id}\` (${orchestrator.name}) first.**`,
      `> Do not perform monolithic implementation directly. The primary orchestrator deconstructs requests into structured sprint tasks, delegating to specialized team agents.`,
      ``,
      `---`,
      ``,
      `## 👥 Active Multi-Agent Team Roster`,
      ``,
      `| Agent ID | Role | Hierarchy | Allowed Tools | Delegation Targets |`,
      `| :--- | :--- | :--- | :--- | :--- |`,
    ];

    agents.forEach((ag) => {
      const isOrch = ag.id === orchestrator.id;
      const hierarchy = isOrch ? '**👑 Primary Orchestrator**' : '*Subagent Specialist*';
      const tools = (ag.tools || ag.allowed_tools || []).join(', ');
      const targets = (ag.handoffTo || ag.delegation_targets || []).join(', ') || '*None*';
      claudeMdLines.push(`| **\`${ag.id}\`** | ${ag.role} | ${hierarchy} | \`${tools}\` | \`${targets}\` |`);
    });

    claudeMdLines.push(``);
    claudeMdLines.push(`---`);
    claudeMdLines.push(``);
    claudeMdLines.push(`## 🛠️ Essential Project Commands`);
    claudeMdLines.push(``);
    claudeMdLines.push(`- **Start Development Server:** \`npm run dev\``);
    claudeMdLines.push(`- **Launch Virtual Office Engine:** \`npm run launch\` or \`node server/launcher.js\``);
    claudeMdLines.push(`- **Validate Canonical Agent Registry:** \`node bin/agents.js validate\``);
    claudeMdLines.push(`- **Synchronize Multi-Provider Outputs:** \`node bin/agents.js sync\``);
    claudeMdLines.push(`- **Run Environment Diagnostics:** \`node bin/agents.js doctor\``);
    claudeMdLines.push(`- **Audit Skills:** \`node bin/agents.js skills\``);
    claudeMdLines.push(``);
    claudeMdLines.push(`---`);
    claudeMdLines.push(``);
    claudeMdLines.push(`## 🔒 Guardrails & Prohibited Actions`);
    claudeMdLines.push(``);

    agents.forEach((ag) => {
      if (ag.prohibited_actions && ag.prohibited_actions.length > 0) {
        claudeMdLines.push(`### \`${ag.id}\` (${ag.name})`);
        ag.prohibited_actions.forEach((act) => {
          claudeMdLines.push(`- 🚫 **${act}**`);
        });
        claudeMdLines.push(``);
      }
    });

    claudeMdLines.push(`---`);
    claudeMdLines.push(``);
    claudeMdLines.push(`## 🧠 Domain Skills Reference`);
    claudeMdLines.push(``);
    agents.forEach((ag) => {
      const skills = ag.skillIds || [];
      if (skills.length > 0) {
        claudeMdLines.push(`- **\`${ag.id}\`**: ${skills.map((s) => `[\`${s}\`](file://${path.join(projectRoot, '.agents', 'skills', s, 'SKILL.md')})`).join(', ')}`);
      }
    });
    claudeMdLines.push(``);

    const claudeMdContent = claudeMdLines.join('\n');
    filesWritten.push(this.writeFileSafely(path.join(projectRoot, 'CLAUDE.md'), claudeMdContent, options));

    // 2. Generate .claude/config.json
    const configData = {
      $schema: 'https://json.schemastore.org/claude-code-config.json',
      project: projectName,
      version: registry.version || '2.0.0',
      orchestrator: orchestrator.id,
      team: {
        agents: agents.map((ag) => {
          const tools = ag.tools || ag.allowed_tools || [];
          const handoff = ag.handoffTo || ag.delegation_targets || [];
          return {
            id: ag.id,
            name: ag.name,
            role: ag.role,
            persona: ag.persona || '',
            goal: ag.goal || '',
            primary: ag.id === orchestrator.id,
            tools,
            allowedTools: tools,
            reportsTo: ag.reportsTo || (ag.id === orchestrator.id ? 'user' : orchestrator.id),
            handoffTo: handoff,
            delegationTargets: handoff,
            skills: ag.skillIds || [],
            inputContract: ag.inputContract || '',
            outputContract: ag.outputContract || '',
            permissions: ag.permissions || [],
            prohibitedActions: ag.prohibited_actions || [],
          };
        }),
      },
      preferences: {
        strictOrchestratorRouting: true,
        enforceDelegationWhitelist: true,
        autoSyncRegistry: true,
      },
    };

    filesWritten.push(
      this.writeFileSafely(
        path.join(projectRoot, '.claude', 'config.json'),
        JSON.stringify(configData, null, 2),
        options
      )
    );

    return {
      success: true,
      filesWritten,
      warnings,
    };
  }
}

module.exports = ClaudeAdapter;
