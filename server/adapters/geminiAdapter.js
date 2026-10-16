/**
 * Gemini CLI Provider Adapter
 *
 * Generates:
 * - GEMINI.md (Context guidelines, primary orchestrator routing, subagent invocation schemas, tool boundaries)
 */

const path = require('path');
const BaseAdapter = require('./baseAdapter');

class GeminiAdapter extends BaseAdapter {
  constructor() {
    super('gemini', 'Gemini CLI context and agent adapter');
    this.targetFiles = ['GEMINI.md'];
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

    const lines = [
      `# Gemini CLI Context Instructions: ${projectName}`,
      ``,
      `> [!IMPORTANT]`,
      `> ### 👑 PRIMARY AGENT ROUTING: \`${orchestrator.id}\` (${orchestrator.name})`,
      `> When Gemini CLI interacts with this repository, always orient your context around the Primary Orchestrator **\`${orchestrator.id}\`**.`,
      `> Never attempt monolithic direct code authoring without first executing task triage and decomposition.`,
      ``,
      `---`,
      ``,
      `## 👥 Agent Hierarchy & Roles`,
      ``,
      `| Agent ID | Name | Role | Type | Tools |`,
      `| :--- | :--- | :--- | :--- | :--- |`,
    ];

    agents.forEach((ag) => {
      const isPrimary = ag.id === orchestrator.id;
      const type = isPrimary ? '**👑 Primary Orchestrator**' : '*Subagent Specialist*';
      lines.push(`| **\`${ag.id}\`** | ${ag.name} | *${ag.role}* | ${type} | \`${(ag.tools || ag.allowed_tools || []).join(', ')}\` |`);
    });

    lines.push(``);
    lines.push(`---`);
    lines.push(``);
    lines.push(`## 🔄 Subagent Delegation Protocol & Schemas`);
    lines.push(``);
    lines.push(`When delegating work between agents, adhere strictly to the invocation schema:`);
    lines.push(``);
    lines.push('```json');
    lines.push(JSON.stringify(
      {
        TypeName: '<target-subagent-id>',
        Role: '<target-subagent-role>',
        Prompt: 'Explicit actionable prompt with expected acceptance criteria.',
        Model: 'inherit',
        Workspace: 'inherit',
      },
      null,
      2
    ));
    lines.push('```');
    lines.push(``);
    lines.push(`### Allowed Delegation Targets:`);
    agents.forEach((ag) => {
      const targets = ag.handoffTo || ag.delegation_targets || [];
      lines.push(`- **\`${ag.id}\`** -> [${targets.map((t) => `\`${t}\``).join(', ') || 'No delegation authority (Reports back to orchestrator)'}]`);
    });

    lines.push(``);
    lines.push(`---`);
    lines.push(``);
    lines.push(`## 🚫 Strict Prohibited Actions & Boundaries`);
    lines.push(``);
    agents.forEach((ag) => {
      if (ag.prohibited_actions && ag.prohibited_actions.length > 0) {
        lines.push(`### \`${ag.id}\``);
        ag.prohibited_actions.forEach((act) => {
          lines.push(`- 🚫 **${act}**`);
        });
        lines.push(``);
      }
    });

    lines.push(`---`);
    lines.push(``);
    lines.push(`## 📚 Domain Skills Directory Mapping`);
    lines.push(``);
    agents.forEach((ag) => {
      const skills = ag.skillIds || [];
      if (skills.length > 0) {
        lines.push(`- **\`${ag.id}\`**: ${skills.map((s) => `[\`${s}\`](file://${path.join(projectRoot, '.agents', 'skills', s, 'SKILL.md')})`).join(', ')}`);
      }
    });
    lines.push(``);

    const content = lines.join('\n');
    filesWritten.push(this.writeFileSafely(path.join(projectRoot, 'GEMINI.md'), content, options));

    return {
      success: true,
      filesWritten,
      warnings,
    };
  }
}

module.exports = GeminiAdapter;
