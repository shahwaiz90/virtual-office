/**
 * Canonical Registry Engine for Universal AI Agent Registry
 *
 * Single Source of Truth (SSOT) manager for:
 * - .agents/registry.yaml (or registry.json)
 * - .agents/definitions/*.md
 * - .agents/skills/*
 */

const fs = require('fs');
const path = require('path');
const { parseYaml, stringifyYaml, parseFrontmatter, stringifyFrontmatter } = require('./frontmatterParser');
const { validateRegistry } = require('./validator');

const REGISTRY_YAML_REL = path.join('.agents', 'registry.yaml');
const REGISTRY_JSON_REL = path.join('.agents', 'registry.json');
const DEFINITIONS_DIR_REL = path.join('.agents', 'definitions');
const SKILLS_DIR_REL = path.join('.agents', 'skills');

/**
 * Checks if a project contains a canonical registry (.agents/registry.yaml, registry.json, or definitions/*.md)
 */
function hasCanonicalRegistry(projectRoot) {
  if (!projectRoot) return false;
  const yamlPath = path.join(projectRoot, REGISTRY_YAML_REL);
  const jsonPath = path.join(projectRoot, REGISTRY_JSON_REL);
  const defsDir = path.join(projectRoot, DEFINITIONS_DIR_REL);

  if (fs.existsSync(yamlPath) || fs.existsSync(jsonPath)) return true;
  if (fs.existsSync(defsDir)) {
    try {
      const files = fs.readdirSync(defsDir);
      if (files.some((f) => f.endsWith('.md'))) return true;
    } catch (_) {}
  }
  return false;
}

/**
 * Discovers all skill directories under .agents/skills
 */
function loadSkillsMap(projectRoot, customSkillsDir = null) {
  let relDir = customSkillsDir || SKILLS_DIR_REL;
  if (!fs.existsSync(path.join(projectRoot, relDir)) && fs.existsSync(path.join(projectRoot, '.agents', relDir))) {
    relDir = path.join('.agents', relDir);
  }
  const skillsDir = path.join(projectRoot, relDir);
  const map = {};
  if (!fs.existsSync(skillsDir)) return map;

  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        const skillId = ent.name;
        const skillDoc = path.join(skillsDir, skillId, 'SKILL.md');
        if (fs.existsSync(skillDoc)) {
          const content = fs.readFileSync(skillDoc, 'utf8');
          // Extract title or summary
          let name = skillId;
          let description = `Domain skill: ${skillId}`;

          const titleMatch = content.match(/^#\s+(.+)$/m);
          if (titleMatch) {
            name = titleMatch[1].trim();
          }

          const descMatch = content.match(/(?:description|summary|overview):\s*([^\n]+)/i);
          if (descMatch) {
            description = descMatch[1].trim();
          } else {
            // Use first non-heading paragraph
            const paragraphs = content.split(/\n\s*\n/).filter((p) => !p.trim().startsWith('#'));
            if (paragraphs.length > 0) {
              description = paragraphs[0].replace(/\r?\n/g, ' ').slice(0, 150).trim();
            }
          }

          map[skillId] = {
            id: skillId,
            name,
            description,
            path: path.relative(projectRoot, skillDoc),
            absPath: skillDoc,
          };
        }
      }
    }
  } catch (err) {
    console.warn(`[canonicalRegistry] Error reading skills directory ${skillsDir}:`, err.message);
  }

  return map;
}

/**
 * Loads the complete canonical registry for a project
 */
function loadRegistry(projectRoot) {
  if (!projectRoot || !fs.existsSync(projectRoot)) {
    return null;
  }

  const yamlPath = path.join(projectRoot, REGISTRY_YAML_REL);
  const jsonPath = path.join(projectRoot, REGISTRY_JSON_REL);
  const defsDir = path.join(projectRoot, DEFINITIONS_DIR_REL);

  let rawManifest = {
    version: '2.0.0',
    name: path.basename(projectRoot),
    description: `Universal multi-agent team registry for ${path.basename(projectRoot)}`,
    orchestrator: null,
    default_framework: 'all',
    agents: [],
    skills_dir: SKILLS_DIR_REL,
    adapters: {
      opencode: { enabled: true, sync_agents_json: true, sync_runtime_manifest: true, sync_team_rule: true },
      claude: { enabled: true, target_file: 'CLAUDE.md', sync_config: true },
      codex: { enabled: true, target_file: 'AGENTS.md' },
      gemini: { enabled: true, target_file: 'GEMINI.md' },
    },
  };

  let manifestFound = false;

  if (fs.existsSync(yamlPath)) {
    try {
      const content = fs.readFileSync(yamlPath, 'utf8');
      const parsed = parseYaml(content);
      if (parsed && typeof parsed === 'object') {
        rawManifest = { ...rawManifest, ...parsed };
        manifestFound = true;
      }
    } catch (e) {
      console.warn(`[canonicalRegistry] Warning reading ${yamlPath}:`, e.message);
    }
  } else if (fs.existsSync(jsonPath)) {
    try {
      const content = fs.readFileSync(jsonPath, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object') {
        rawManifest = { ...rawManifest, ...parsed };
        manifestFound = true;
      }
    } catch (e) {
      console.warn(`[canonicalRegistry] Warning reading ${jsonPath}:`, e.message);
    }
  }

  // Load skills map
  const skillsMap = loadSkillsMap(projectRoot, rawManifest.skills_dir);

  // Load agents from definitions/*.md
  const loadedAgents = [];
  const processedAgentIds = new Set();

  // 1. Process agents specified in manifest
  const manifestAgentEntries = Array.isArray(rawManifest.agents) ? rawManifest.agents : [];

  manifestAgentEntries.forEach((entry, idx) => {
    const agentId = typeof entry === 'string' ? entry : entry.id;
    if (!agentId) return;

    let defFile = entry.path ? path.resolve(projectRoot, '.agents', entry.path) : path.join(defsDir, `${agentId}.md`);
    if (!fs.existsSync(defFile)) {
      defFile = path.resolve(projectRoot, entry.path || path.join(DEFINITIONS_DIR_REL, `${agentId}.md`));
    }

    let agentData = {
      // 1. Identity
      id: agentId,
      name: agentId,
      description: '',
      badge: 'AGT',
      avatar_url: '/assets/developer.png',
      // 2. Behavior
      role: 'Specialist',
      persona: '',
      goal: '',
      is_primary: idx === 0,
      // 3. Capabilities
      skills: [],
      tools: ['view_file'],
      allowed_tools: ['view_file'],
      enable_subagent_tools: false,
      enable_write_tools: true,
      enable_mcp_tools: false,
      // 4. Execution
      inputContract: '',
      outputContract: '',
      // 5. Governance
      permissions: [],
      prohibited_actions: [],
      // 6. Coordination
      reportsTo: null,
      handoffTo: [],
      delegation_targets: [],
      instructions: '',
    };

    if (fs.existsSync(defFile)) {
      try {
        const fileContent = fs.readFileSync(defFile, 'utf8');
        const fm = parseFrontmatter(fileContent);
        agentData = {
          ...agentData,
          ...fm.data,
          instructions: fm.body || '',
        };
      } catch (err) {
        console.warn(`[canonicalRegistry] Failed parsing definition ${defFile}:`, err.message);
      }
    }

    if (typeof entry === 'object') {
      if (entry.primary !== undefined) agentData.is_primary = Boolean(entry.primary);
      if (entry.name && !agentData.name) agentData.name = entry.name;
    }

    processedAgentIds.add(agentId);
    loadedAgents.push(agentData);
  });

  // 2. Discover any additional .agents/definitions/*.md not mentioned in manifest
  if (fs.existsSync(defsDir)) {
    try {
      const defFiles = fs.readdirSync(defsDir).filter((f) => f.endsWith('.md'));
      for (const f of defFiles) {
        const candidateId = f.replace(/\.md$/, '');
        if (!processedAgentIds.has(candidateId)) {
          const fullPath = path.join(defsDir, f);
          try {
            const fileContent = fs.readFileSync(fullPath, 'utf8');
            const fm = parseFrontmatter(fileContent);
            const ag = {
              // 1. Identity
              id: candidateId,
              name: candidateId,
              description: '',
              badge: 'AGT',
              avatar_url: '/assets/developer.png',
              // 2. Behavior
              role: 'Specialist',
              persona: '',
              goal: '',
              is_primary: false,
              // 3. Capabilities
              skills: [],
              tools: ['view_file'],
              allowed_tools: ['view_file'],
              enable_subagent_tools: false,
              enable_write_tools: true,
              enable_mcp_tools: false,
              // 4. Execution
              inputContract: '',
              outputContract: '',
              // 5. Governance
              permissions: [],
              prohibited_actions: [],
              // 6. Coordination
              reportsTo: null,
              handoffTo: [],
              delegation_targets: [],
              instructions: fm.body || '',
              ...fm.data,
            };
            processedAgentIds.add(candidateId);
            loadedAgents.push(ag);
          } catch (err) {
            console.warn(`[canonicalRegistry] Failed parsing ${fullPath}:`, err.message);
          }
        }
      }
    } catch (err) {
      console.warn(`[canonicalRegistry] Error scanning ${defsDir}:`, err.message);
    }
  }

  // Determine orchestrator
  let orchestratorId = rawManifest.orchestrator;
  if (!orchestratorId && loadedAgents.length > 0) {
    const primaryAgent = loadedAgents.find((a) => a.is_primary);
    orchestratorId = primaryAgent ? primaryAgent.id : loadedAgents[0].id;
  }

  // Ensure is_primary flag matches orchestrator and normalize all 6 categories
  loadedAgents.forEach((ag) => {
    if (ag.id === orchestratorId) {
      ag.is_primary = true;
    }

    // 1. Identity
    ag.description = ag.description || '';

    // 2. Behavior
    ag.persona = ag.persona || '';
    ag.goal = ag.goal || '';

    // 3. Capabilities (harmonize tools and allowed_tools)
    const rawTools = ag.tools !== undefined ? ag.tools : ag.allowed_tools;
    const normalizedTools = Array.isArray(rawTools) ? rawTools : (rawTools ? [rawTools] : ['view_file']);
    ag.tools = normalizedTools;
    ag.allowed_tools = normalizedTools;

    // 4. Execution
    ag.inputContract = ag.inputContract || '';
    ag.outputContract = ag.outputContract || '';

    // 5. Governance
    ag.permissions = Array.isArray(ag.permissions) ? ag.permissions : (ag.permissions ? [ag.permissions] : []);
    ag.prohibited_actions = Array.isArray(ag.prohibited_actions) ? ag.prohibited_actions : [];

    // 6. Coordination (harmonize handoffTo, delegation_targets, and reportsTo)
    const rawHandoff = ag.handoffTo !== undefined ? ag.handoffTo : ag.delegation_targets;
    const normalizedHandoff = Array.isArray(rawHandoff) ? rawHandoff : (rawHandoff ? [rawHandoff] : []);
    ag.handoffTo = normalizedHandoff;
    ag.delegation_targets = normalizedHandoff;

    if (ag.reportsTo === undefined || ag.reportsTo === null) {
      ag.reportsTo = ag.is_primary ? 'user' : orchestratorId;
    }

    // Normalize skills to string IDs + enrich
    const rawSkills = Array.isArray(ag.skills) ? ag.skills : [];
    ag.skillIds = rawSkills.map((s) => (typeof s === 'string' ? s : s.id || s.name));
    ag.skillDetails = ag.skillIds.map((skId) => skillsMap[skId] || { id: skId, name: skId, description: `Skill: ${skId}`, path: `.agents/skills/${skId}/SKILL.md` });
  });

  return {
    version: rawManifest.version || '2.0.0',
    name: rawManifest.name || path.basename(projectRoot),
    description: rawManifest.description || '',
    orchestrator: orchestratorId,
    default_framework: rawManifest.default_framework || 'all',
    skills_dir: rawManifest.skills_dir || SKILLS_DIR_REL,
    adapters: rawManifest.adapters || {},
    agents: loadedAgents,
    skills: skillsMap,
    manifestFound,
    projectRoot,
  };
}

/**
 * Saves canonical registry definitions and manifest to disk
 */
function saveRegistry(registry, projectRoot) {
  if (!projectRoot || !registry) {
    throw new Error('projectRoot and registry must be provided.');
  }

  const defsDir = path.join(projectRoot, DEFINITIONS_DIR_REL);
  if (!fs.existsSync(defsDir)) {
    fs.mkdirSync(defsDir, { recursive: true });
  }

  // 1. Save each agent definition .md
  const manifestAgents = [];

  (registry.agents || []).forEach((ag) => {
    const defFile = path.join(defsDir, `${ag.id}.md`);
    const tools = ag.tools || ag.allowed_tools || ['view_file'];
    const handoff = ag.handoffTo || ag.delegation_targets || [];
    const isPrimary = Boolean(ag.is_primary || ag.id === registry.orchestrator);

    const frontmatterData = {
      // 1. Identity
      id: ag.id,
      name: ag.name,
      description: ag.description || '',
      badge: ag.badge || ag.id.slice(0, 3).toUpperCase(),
      avatar_url: ag.avatar_url || '/assets/developer.png',

      // 2. Behavior
      role: ag.role,
      persona: ag.persona || '',
      goal: ag.goal || '',
      is_primary: isPrimary,

      // 3. Capabilities
      skills: ag.skillIds || (Array.isArray(ag.skills) ? ag.skills.map((s) => (typeof s === 'string' ? s : s.id)) : []),
      tools,
      allowed_tools: tools,
      enable_subagent_tools: Boolean(ag.enable_subagent_tools),
      enable_write_tools: Boolean(ag.enable_write_tools),
      enable_mcp_tools: Boolean(ag.enable_mcp_tools),

      // 4. Execution
      inputContract: ag.inputContract || '',
      outputContract: ag.outputContract || '',

      // 5. Governance
      permissions: ag.permissions || [],
      prohibited_actions: ag.prohibited_actions || [],

      // 6. Coordination
      reportsTo: ag.reportsTo !== undefined ? ag.reportsTo : (isPrimary ? 'user' : registry.orchestrator),
      handoffTo: handoff,
      delegation_targets: handoff,
    };

    const bodyContent = ag.instructions || ag.system_prompt || ag.body || '';
    const fileContent = stringifyFrontmatter(frontmatterData, bodyContent);
    fs.writeFileSync(defFile, fileContent, 'utf8');

    manifestAgents.push({
      id: ag.id,
      path: `definitions/${ag.id}.md`,
      ...(frontmatterData.is_primary ? { primary: true } : {}),
    });
  });

  // 2. Save .agents/registry.yaml
  const registryYamlPath = path.join(projectRoot, REGISTRY_YAML_REL);
  const manifestData = {
    version: registry.version || '2.0.0',
    name: registry.name || path.basename(projectRoot),
    description: registry.description || `Universal multi-agent team registry for ${path.basename(projectRoot)}`,
    orchestrator: registry.orchestrator || (manifestAgents[0] ? manifestAgents[0].id : null),
    default_framework: registry.default_framework || 'all',
    agents: manifestAgents,
    skills_dir: registry.skills_dir || 'skills',
    adapters: registry.adapters || {
      opencode: { enabled: true, sync_agents_json: true, sync_runtime_manifest: true, sync_team_rule: true },
      claude: { enabled: true, target_file: 'CLAUDE.md', sync_config: true },
      codex: { enabled: true, target_file: 'AGENTS.md' },
      gemini: { enabled: true, target_file: 'GEMINI.md' },
    },
  };

  const yamlOutput = stringifyYaml(manifestData);
  fs.writeFileSync(registryYamlPath, yamlOutput, 'utf8');

  return {
    success: true,
    registryYamlPath,
    agentsCount: manifestAgents.length,
  };
}

module.exports = {
  hasCanonicalRegistry,
  loadRegistry,
  saveRegistry,
  loadSkillsMap,
  validateRegistry,
  REGISTRY_YAML_REL,
  REGISTRY_JSON_REL,
  DEFINITIONS_DIR_REL,
  SKILLS_DIR_REL,
};
