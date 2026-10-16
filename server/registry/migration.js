/**
 * Migration Engine for Universal AI Agent Registry
 *
 * Migrates legacy `.agents/agents.json` to canonical:
 * - `.agents/registry.yaml`
 * - `.agents/definitions/<agent-id>.md`
 * Creates safe backup in `.agents/backup/`.
 */

const fs = require('fs');
const path = require('path');
const { stringifyYaml, stringifyFrontmatter } = require('./frontmatterParser');
const { buildEnforcedSystemPrompt } = require('../agentRuntimeRegistry');
const { getAllSkills } = require('../officialSkills');

/**
 * Migrates a project from legacy agents.json to canonical registry.
 *
 * @param {string} projectRoot - Root directory
 * @param {object} [options] - Migration options { force: boolean }
 * @returns {Promise<{ success: boolean, backupDir: string, agentsMigrated: string[], filesCreated: string[], message: string }>}
 */
async function migrateProject(projectRoot = process.cwd(), options = {}) {
  const legacyPath = path.join(projectRoot, '.agents', 'agents.json');
  if (!fs.existsSync(legacyPath)) {
    throw new Error(`Legacy configuration file not found at ${legacyPath}`);
  }

  const rawJson = fs.readFileSync(legacyPath, 'utf8');
  let legacyData;
  try {
    legacyData = JSON.parse(rawJson);
  } catch (err) {
    throw new Error(`Failed to parse ${legacyPath}: ${err.message}`);
  }

  const rawAgents = legacyData.agents || [];
  if (!Array.isArray(rawAgents) || rawAgents.length === 0) {
    throw new Error(`No agents array found in ${legacyPath}`);
  }

  // 1. Create timestamped backup
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(projectRoot, '.agents', 'backup', `migration-${timestamp}`);
  fs.mkdirSync(backupDir, { recursive: true });

  fs.writeFileSync(path.join(backupDir, 'agents.json.bak'), rawJson, 'utf8');

  // Also backup AGENTS.md if it exists
  const agentsMd = path.join(projectRoot, 'AGENTS.md');
  if (fs.existsSync(agentsMd)) {
    fs.copyFileSync(agentsMd, path.join(backupDir, 'AGENTS.md.bak'));
  }

  const filesCreated = [];
  const agentsMigrated = [];

  // 2. Prepare .agents/definitions/ directory
  const defsDir = path.join(projectRoot, '.agents', 'definitions');
  if (!fs.existsSync(defsDir)) {
    fs.mkdirSync(defsDir, { recursive: true });
  }

  const primaryAgent = rawAgents[0];
  const allSkills = getAllSkills(projectRoot);

  const manifestAgents = [];

  // 3. Migrate each agent to .agents/definitions/<id>.md
  for (let idx = 0; idx < rawAgents.length; idx++) {
    const ag = rawAgents[idx];
    const isPrimary = idx === 0;
    const agentId = ag.id || `agent-${idx + 1}`;

    const prompt = buildEnforcedSystemPrompt(
      { ...ag, isPrimary },
      rawAgents,
      allSkills,
      projectRoot,
      primaryAgent
    );

    const frontmatterData = {
      id: agentId,
      name: ag.name || agentId,
      role: ag.role || (isPrimary ? 'Primary Orchestrator' : 'Specialist'),
      badge: ag.badge || (isPrimary ? 'PM' : (ag.name || 'AGT').slice(0, 3).toUpperCase()),
      avatar_url: ag.avatar_url || ag.avatarUrl || (isPrimary ? '/assets/projectmanager.png' : '/assets/developer.png'),
      description: ag.description || '',
      is_primary: isPrimary,
      allowed_tools: ag.allowed_tools || ag.allowedTools || ['view_file'],
      enable_subagent_tools: Boolean(ag.enable_subagent_tools !== undefined ? ag.enable_subagent_tools : isPrimary),
      enable_write_tools: Boolean(ag.enable_write_tools !== undefined ? ag.enable_write_tools : true),
      enable_mcp_tools: Boolean(ag.enable_mcp_tools || false),
      prohibited_actions: ag.prohibited_actions || ag.prohibitedActions || [],
      delegation_targets: ag.delegation_targets || ag.delegationTargets || [],
      skills: (ag.skills || ag.skillIds || []).map((s) => (typeof s === 'string' ? s : s.id || s.name)),
    };

    const targetDefPath = path.join(defsDir, `${agentId}.md`);
    const fileContent = stringifyFrontmatter(frontmatterData, prompt);
    fs.writeFileSync(targetDefPath, fileContent, 'utf8');

    filesCreated.push(path.relative(projectRoot, targetDefPath));
    agentsMigrated.push(agentId);

    manifestAgents.push({
      id: agentId,
      path: `definitions/${agentId}.md`,
      ...(isPrimary ? { primary: true } : {}),
    });
  }

  // 4. Generate .agents/registry.yaml
  const registryYamlPath = path.join(projectRoot, '.agents', 'registry.yaml');
  const registryData = {
    version: '2.0.0',
    name: path.basename(projectRoot),
    description: legacyData.description || `Universal multi-agent team registry for ${path.basename(projectRoot)}`,
    orchestrator: primaryAgent.id,
    default_framework: 'all',
    agents: manifestAgents,
    skills_dir: 'skills',
    adapters: {
      opencode: {
        enabled: true,
        sync_agents_json: true,
        sync_runtime_manifest: true,
        sync_team_rule: true,
      },
      claude: {
        enabled: true,
        target_file: 'CLAUDE.md',
        sync_config: true,
      },
      codex: {
        enabled: true,
        target_file: 'AGENTS.md',
      },
      gemini: {
        enabled: true,
        target_file: 'GEMINI.md',
      },
    },
  };

  const yamlContent = stringifyYaml(registryData);
  fs.writeFileSync(registryYamlPath, yamlContent, 'utf8');
  filesCreated.push(path.relative(projectRoot, registryYamlPath));

  return {
    success: true,
    backupDir: path.relative(projectRoot, backupDir),
    agentsMigrated,
    filesCreated,
    message: `Successfully migrated ${agentsMigrated.length} agents into canonical registry.`,
  };
}

module.exports = {
  migrateProject,
};
