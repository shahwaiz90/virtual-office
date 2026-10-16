/**
 * OpenAI Codex Provider Adapter
 *
 * Generates:
 * - .codex/system-prompts.md (Codex multi-agent prompt directives and tool specifications)
 * - .codex/instructions.md (Project workspace instructions for Codex CLI/IDE)
 */

const path = require('path');
const BaseAdapter = require('./baseAdapter');

class CodexAdapter extends BaseAdapter {
  constructor() {
    super('codex', 'OpenAI Codex system prompt and tool adapter');
    this.targetFiles = [
      path.join('.codex', 'system-prompts.md'),
      path.join('.codex', 'instructions.md'),
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

    // 1. Generate .codex/instructions.md
    const instructionsLines = [
      `# OpenAI Codex Workspace Instructions: ${projectName}`,
      ``,
      `## Multi-Agent Hierarchy & Orchestration`,
      `Primary Orchestrator: \`${orchestrator.id}\` (${orchestrator.name})`,
      ``,
      `When initiating coding tasks or analyzing requirements:`,
      `1. Assume the role of \`${orchestrator.id}\` to intake and partition feature tasks.`,
      `2. Strictly follow the tool execution whitelist and delegation boundaries defined per agent.`,
      `3. Never bypass architect reviews for direct commits.`,
      ``,
      `## Agent Roster & Guardrails`,
    ];

    agents.forEach((ag) => {
      instructionsLines.push(`### \`${ag.id}\` (${ag.name}) - ${ag.role}`);
      if (ag.goal) instructionsLines.push(`- **Goal:** ${ag.goal}`);
      instructionsLines.push(`- **Allowed Tools:** \`${(ag.tools || ag.allowed_tools || []).join(', ')}\``);
      instructionsLines.push(`- **Delegates To:** \`${(ag.handoffTo || ag.delegation_targets || []).join(', ') || 'None'}\``);
      if (ag.reportsTo) instructionsLines.push(`- **Reports To:** \`${ag.reportsTo}\``);
      if (ag.inputContract) instructionsLines.push(`- **Input Contract:** ${ag.inputContract}`);
      if (ag.outputContract) instructionsLines.push(`- **Output Contract:** ${ag.outputContract}`);
      if (ag.prohibited_actions && ag.prohibited_actions.length > 0) {
        instructionsLines.push(`- **Strict Guardrails:**`);
        ag.prohibited_actions.forEach((act) => {
          instructionsLines.push(`  - 🚫 ${act}`);
        });
      }
      instructionsLines.push(``);
    });

    filesWritten.push(
      this.writeFileSafely(
        path.join(projectRoot, '.codex', 'instructions.md'),
        instructionsLines.join('\n'),
        options
      )
    );

    // 2. Generate .codex/system-prompts.md
    const promptLines = [
      `# OpenAI Codex System Prompts & Tool Specifications`,
      ``,
      `This file contains compiled system prompts and tool constraints for all registered agents in ${projectName}.`,
      ``,
    ];

    agents.forEach((ag) => {
      const isPrimary = ag.id === orchestrator.id;
      promptLines.push(`---`);
      promptLines.push(`## Agent Prompt: \`${ag.id}\` (${ag.name})`);
      promptLines.push(`**Role:** ${ag.role} | **Type:** ${isPrimary ? 'Primary Orchestrator' : 'Specialist Subagent'}`);
      promptLines.push(``);
      promptLines.push('```markdown');
      if (ag.instructions && ag.instructions.trim().length > 50) {
        promptLines.push(ag.instructions.trim());
      } else {
        promptLines.push(`You are ${ag.name} (\`${ag.id}\`), serving as ${ag.role}.`);
        promptLines.push(`Description: ${ag.description || ag.role}`);
        if (ag.persona) promptLines.push(`Persona: ${ag.persona}`);
        if (ag.goal) promptLines.push(`Goal: ${ag.goal}`);
        promptLines.push(``);
        promptLines.push(`Authorized Tools: ${(ag.tools || ag.allowed_tools || []).join(', ')}`);
        promptLines.push(`Delegation Targets: ${(ag.handoffTo || ag.delegation_targets || []).join(', ') || 'None'}`);
        if (ag.reportsTo) promptLines.push(`Reports To: ${ag.reportsTo}`);
        if (ag.inputContract) promptLines.push(`Input Contract: ${ag.inputContract}`);
        if (ag.outputContract) promptLines.push(`Output Contract: ${ag.outputContract}`);
        if (ag.prohibited_actions && ag.prohibited_actions.length > 0) {
          promptLines.push(`Prohibited Actions:`);
          ag.prohibited_actions.forEach((act) => promptLines.push(`- ${act}`));
        }
      }
      promptLines.push('```');
      promptLines.push(``);
    });

    filesWritten.push(
      this.writeFileSafely(
        path.join(projectRoot, '.codex', 'system-prompts.md'),
        promptLines.join('\n'),
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

module.exports = CodexAdapter;
