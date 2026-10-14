const fs = require('fs');
const path = require('path');

/**
 * Resolves the target project directory from:
 * 1. CLI argument (--dir, -d, --project)
 * 2. Environment variable (PROJECT_DIR, AGENTS_PROJECT_DIR, AGENTS_DIR)
 * 3. Current working directory (if .agents or agents.json exists, or fallback)
 * 4. Workspace repository root (2 levels up from server/)
 */
function getProjectRoot() {
  // 1. CLI args
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if ((arg === '--dir' || arg === '-d' || arg === '--project') && process.argv[i + 1]) {
      return path.resolve(process.argv[i + 1]);
    }
    if (arg.startsWith('--dir=')) {
      return path.resolve(arg.split('=')[1]);
    }
    if (arg.startsWith('--project=')) {
      return path.resolve(arg.split('=')[1]);
    }
  }

  // 2. Env variable
  if (process.env.PROJECT_DIR) {
    return path.resolve(process.env.PROJECT_DIR);
  }
  if (process.env.AGENTS_PROJECT_DIR) {
    return path.resolve(process.env.AGENTS_PROJECT_DIR);
  }
  if (process.env.AGENTS_DIR) {
    return path.resolve(process.env.AGENTS_DIR);
  }

  // 3. Current working directory check
  const cwd = process.cwd();
  if (
    fs.existsSync(path.join(cwd, '.agents/agents.json')) ||
    fs.existsSync(path.join(cwd, 'agents.json')) ||
    fs.existsSync(path.join(cwd, '.agents.json')) ||
    fs.existsSync(path.join(cwd, '.agents'))
  ) {
    return cwd;
  }

  // 4. Default fallback: repository root relative to this package
  const repoFallback = path.resolve(__dirname, '../..');
  if (
    fs.existsSync(path.join(repoFallback, '.agents/agents.json')) ||
    fs.existsSync(path.join(repoFallback, 'agents.json'))
  ) {
    return repoFallback;
  }

  return cwd;
}

const PROJECT_ROOT = getProjectRoot();

const IGNORED_SCAN_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.idea',
  '.vscode',
  'Pods',
  'vendor',
  '.gradle',
  'target',
  'out',
  'coverage',
  '.turbo',
]);

/**
 * Recursively scans a directory tree looking for ALL agents.json files (breadth-first, max depth 5).
 * Accurately finds configurations across monorepos and multiple subfolders.
 */
function scanForAllAgentsConfigs(baseDir, maxDepth = 5) {
  if (!baseDir || !fs.existsSync(baseDir)) return [];

  const found = [];
  const queue = [[baseDir, 0]];

  while (queue.length > 0) {
    const [dir, depth] = queue.shift();

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      // First check all files in current directory level
      for (const entry of entries) {
        if (entry.isFile()) {
          const lower = entry.name.toLowerCase();
          if (lower === 'agents.json' || lower === 'agents_config.json' || lower === 'opencode_agents.json') {
            found.push(path.join(dir, entry.name));
          }
        }
      }

      // If within maxDepth, enqueue child directories
      if (depth < maxDepth) {
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (!IGNORED_SCAN_DIRS.has(entry.name) && !entry.name.startsWith('.git')) {
              queue.push([path.join(dir, entry.name), depth + 1]);
            }
          }
        }
      }
    } catch (e) {
      // Ignore unreadable/permission-denied folders
    }
  }

  return found;
}

/**
 * Dynamically resolves ALL agent configuration files in the project.
 * Supports explicit single-config via CLI/env or multi-config discovery.
 */
function findAllAgentsConfigFiles(customRoot, explicitConfigPath) {
  // If user explicitly provided a single config via --config flag or AGENTS_CONFIG
  const explicit = explicitConfigPath || process.env.AGENTS_CONFIG;
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (fs.existsSync(resolved)) {
      return [resolved];
    }
    console.warn(`[AgentDiscovery] Warning: Explicit config specified at ${resolved} not found.`);
  }

  const root = customRoot || getProjectRoot();
  const fileSet = new Set();

  // 1. High-priority direct candidates
  const directCandidates = [
    path.join(root, '.agents/agents.json'),
    path.join(root, 'opencode/agents.json'),
    path.join(root, '.opencode/agents.json'),
    path.join(root, 'opencopde/agents.json'),
    path.join(root, '.opencopde/agents.json'),
    path.join(root, 'agents.json'),
    path.join(root, '.agents.json'),
    path.join(root, 'agents/agents.json'),
    path.join(root, 'agent/agents.json'),
    path.join(root, 'config/agents.json'),
    path.join(root, '.agents/config.json'),
  ];

  for (const candidate of directCandidates) {
    if (fs.existsSync(candidate)) {
      fileSet.add(path.resolve(candidate));
    }
  }

  // 2. Deep recursive scan of all folders in root directory
  const scanned = scanForAllAgentsConfigs(root);
  for (const file of scanned) {
    fileSet.add(path.resolve(file));
  }

  // 3. Fallback scan in process.cwd() if different from root
  if (process.cwd() !== root) {
    for (const candidate of directCandidates.map((c) => path.join(process.cwd(), path.relative(root, c)))) {
      if (fs.existsSync(candidate)) {
        fileSet.add(path.resolve(candidate));
      }
    }
    const scannedCwd = scanForAllAgentsConfigs(process.cwd());
    for (const file of scannedCwd) {
      fileSet.add(path.resolve(file));
    }
  }

  return Array.from(fileSet);
}

/**
 * Backwards-compatible single-file resolver (returns the primary/first file found)
 */
function findAgentsConfigFile(customRoot, explicitConfigPath) {
  const all = findAllAgentsConfigFiles(customRoot, explicitConfigPath);
  return all.length > 0 ? all[0] : path.join(customRoot || getProjectRoot(), '.agents/agents.json');
}

/**
 * Dynamically resolves the skills directory, checking adjacent folders to agents.json as well
 */
function findSkillsDirectory(customRoot) {
  const root = customRoot || getProjectRoot();

  // If agents.json was found in a subfolder (e.g. opencode/agents.json), check adjacent skills
  const configPath = findAgentsConfigFile(root);
  if (fs.existsSync(configPath)) {
    const configDir = path.dirname(configPath);
    const adjacentSkills = [
      path.join(configDir, 'skills'),
      path.join(configDir, '.skills'),
      path.join(path.dirname(configDir), 'skills'),
      path.join(path.dirname(configDir), '.agents/skills'),
      path.join(path.dirname(configDir), 'opencode/skills'),
    ];
    for (const candidate of adjacentSkills) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  const candidates = [
    path.join(root, '.agents/skills'),
    path.join(root, 'opencode/skills'),
    path.join(root, '.opencode/skills'),
    path.join(root, 'opencopde/skills'),
    path.join(root, 'skills'),
    path.join(root, '.skills'),
    path.join(process.cwd(), '.agents/skills'),
    path.join(process.cwd(), 'opencode/skills'),
    path.join(process.cwd(), 'skills'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return path.join(root, '.agents/skills');
}

// Fallback default 4-role team template when no agents.json is present
const DEFAULT_FALLBACK_AGENTS = [
  {
    id: 'project-manager',
    name: 'Project Manager',
    role: 'Delivery Lead & Sprint Orchestrator',
    badge: 'PM',
    description: 'Manages project intake, scopes requirements, coordinates workflows, and delivers final reports.',
    skills: ['requirement-analysis', 'sprint-planning', 'pm-reporting'],
    allowed_tools: ['view_file', 'invoke_subagent', 'send_message', 'read_url_content'],
    prohibited_actions: ['No direct application code modifications'],
    delegation_targets: ['tech-lead', 'user'],
  },
  {
    id: 'tech-lead',
    name: 'Technical Lead',
    role: 'System Architect & Code Reviewer',
    badge: 'LEAD',
    description: 'Plans architecture boundaries, pre-maps impacted files, specifies unit tests, and conducts code reviews.',
    skills: ['architecture', 'impact-analysis', 'code-review'],
    allowed_tools: ['view_file', 'git_diff', 'invoke_subagent', 'send_message'],
    prohibited_actions: ['No direct code writing (review and planning only)'],
    delegation_targets: ['developer', 'tester'],
  },
  {
    id: 'developer',
    name: 'Developer',
    role: 'Core Feature Engineer',
    badge: 'DEV',
    description: 'Sole code author: implements feature layers, writes unit tests, and documents implementation.',
    skills: ['feature-implementation', 'unit-tests', 'refactoring'],
    allowed_tools: ['write_to_file', 'replace_file_content', 'view_file', 'run_command'],
    prohibited_actions: ['No altering architectural boundaries without lead approval'],
    delegation_targets: ['tech-lead'],
  },
  {
    id: 'tester',
    name: 'Tester / QA',
    role: 'Quality Assurance & Verification',
    badge: 'QA',
    description: 'Executes automated test suites, validates regressions, and generates verification reports.',
    skills: ['test-automation', 'regression-testing'],
    allowed_tools: ['run_command', 'git_diff'],
    prohibited_actions: ['No modifying production code'],
    delegation_targets: ['developer', 'project-manager'],
  },
];

// Curated palette array for deterministic assignment to any arbitrary list of agents
// Refined, humanized modern design tokens for up to 12+ unique roles
const CURATED_PALETTES = [
  {
    themeColor: '#4f46e5', // Royal Indigo (Management / PM)
    lightColor: '#eef2ff',
    clothingColor: '#4338ca',
    accessory: 'clipboard',
    hairColor: '#3e2723',
    skinColor: '#f5d0b5',
  },
  {
    themeColor: '#0f766e', // Deep Teal / Ocean (Tech Lead / Architect)
    lightColor: '#f0fdfa',
    clothingColor: '#115e59',
    accessory: 'glasses',
    hairColor: '#212121',
    skinColor: '#ebd2b4',
  },
  {
    themeColor: '#7c3aed', // Modern Violet (Fullstack / Frontend)
    lightColor: '#f5f3ff',
    clothingColor: '#6d28d9',
    accessory: 'headphones',
    hairColor: '#4e342e',
    skinColor: '#ffd7ba',
  },
  {
    themeColor: '#e11d48', // Warm Coral / Rose (QA & Test Automation)
    lightColor: '#fff1f2',
    clothingColor: '#be123c',
    accessory: 'toolbelt',
    hairColor: '#e0a96d',
    skinColor: '#f8d5c2',
  },
  {
    themeColor: '#0284c7', // Sky Blue (Backend / Core API Services)
    lightColor: '#f0f9ff',
    clothingColor: '#0369a1',
    accessory: 'tablet',
    hairColor: '#1c1917',
    skinColor: '#fed7aa',
  },
  {
    themeColor: '#059669', // Emerald Green (Security & Compliance)
    lightColor: '#ecfdf5',
    clothingColor: '#047857',
    accessory: 'badge',
    hairColor: '#451a03',
    skinColor: '#ffedd5',
  },
  {
    themeColor: '#d97706', // Warm Amber (DevOps / CI/CD / Cloud Infra)
    lightColor: '#fffbeb',
    clothingColor: '#b45309',
    accessory: 'server',
    hairColor: '#292524',
    skinColor: '#fed7aa',
  },
  {
    themeColor: '#c026d3', // Fuchsia / Magenta (UI/UX & Product Design)
    lightColor: '#fdf4ff',
    clothingColor: '#a21caf',
    accessory: 'palette',
    hairColor: '#3b0764',
    skinColor: '#fce7f3',
  },
  {
    themeColor: '#0891b2', // Cyan (Mobile Engineering: iOS & Android)
    lightColor: '#ecfeff',
    clothingColor: '#0e7490',
    accessory: 'phone',
    hairColor: '#18181b',
    skinColor: '#fef08a',
  },
  {
    themeColor: '#dc2626', // Crimson (Release Manager & Operations)
    lightColor: '#fef2f2',
    clothingColor: '#b91c1c',
    accessory: 'radio',
    hairColor: '#262626',
    skinColor: '#fed7aa',
  },
  {
    themeColor: '#ea580c', // Bright Orange (Data Engineer & AI / ML)
    lightColor: '#fff7ed',
    clothingColor: '#c2410c',
    accessory: 'chip',
    hairColor: '#1c1917',
    skinColor: '#fde047',
  },
  {
    themeColor: '#16a34a', // Forest Green (Performance & SRE)
    lightColor: '#f0fdf4',
    clothingColor: '#15803d',
    accessory: 'gauge',
    hairColor: '#27272a',
    skinColor: '#fed7aa',
  },
];

/**
 * Dynamically computes non-overlapping office slots and room bounds
 * for ANY arbitrary agent count (4, 6, 8, 10, 12+).
 */
function generateOfficeSlots(count) {
  const total = Math.max(count, 4);
  const leftCount = Math.ceil(total / 2);
  const rightCount = Math.floor(total / 2);
  const maxRows = Math.max(leftCount, rightCount, 2);

  const rowHeight = maxRows <= 2 ? 290 : 240;
  const rowGap = maxRows <= 2 ? 30 : 25;
  const topMargin = 35;
  const roomW = 420;

  const slots = [];
  for (let i = 0; i < total; i++) {
    const isLeft = i % 2 === 0;
    const row = Math.floor(i / 2);
    const x = isLeft ? 35 : 745;
    const y = topMargin + row * (rowHeight + rowGap);

    slots.push({
      roomBounds: { x, y, w: roomW, h: rowHeight },
      deskPosition: {
        x: x + roomW / 2,
        y: y + rowHeight / 2 + (maxRows <= 2 ? 0 : 15),
      },
      facing: row === 0 ? 'south' : 'north',
    });
  }

  return slots;
}

/**
 * Computes a human-readable badge text from agent name or ID
 */
function deriveBadge(agentId, agentName) {
  const norm = `${agentId || ''} ${agentName || ''}`.toLowerCase();
  if (norm.includes('project-manager') || norm.includes('pm')) return 'PM';
  if (norm.includes('product-owner') || norm.includes('po')) return 'PO';
  if (norm.includes('architect') || norm.includes('arch')) return 'ARCH';
  if (norm.includes('tech-lead') || norm.includes('techlead') || norm.includes('lead')) return 'LEAD';
  if (norm.includes('frontend') || norm.includes('ui') || norm.includes('web')) return 'FE';
  if (norm.includes('backend') || norm.includes('api')) return 'BE';
  if (norm.includes('devops') || norm.includes('sre') || norm.includes('infra')) return 'OPS';
  if (norm.includes('security') || norm.includes('sec')) return 'SEC';
  if (norm.includes('mobile') || norm.includes('ios') || norm.includes('android')) return 'MOB';
  if (norm.includes('tester') || norm.includes('qa') || norm.includes('test')) return 'QA';
  if (norm.includes('data') || norm.includes('ml') || norm.includes('ai')) return 'DATA';
  if (norm.includes('dev') || norm.includes('developer')) return 'DEV';

  // Fallback to capital letters of the name words
  const words = (agentName || agentId).split(/[\s\-_]+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return (agentId || 'AGT').substring(0, 3).toUpperCase();
}

/**
 * Parses frontmatter / description from a SKILL.md file dynamically
 */
function readSkillMetadata(skillName, customRoot) {
  const skillsDir = findSkillsDirectory(customRoot);
  const skillFile = path.join(skillsDir, skillName, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    return {
      id: skillName,
      name: skillName,
      description: `Skill ${skillName} configured for project workflow`,
      path: skillFile,
    };
  }

  try {
    const content = fs.readFileSync(skillFile, 'utf8');
    const descMatch = content.match(/description:\s*(.+)/);
    const titleMatch = content.match(/#\s*(.+)/);

    const lines = content.split('\n');
    let summaryParagraph = '';
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('# ')) {
        for (let j = i + 1; j < lines.length; j++) {
          const trimmed = lines[j].trim();
          if (trimmed && !trimmed.startsWith('>') && !trimmed.startsWith('---')) {
            summaryParagraph = trimmed;
            break;
          }
        }
        break;
      }
    }

    return {
      id: skillName,
      name: titleMatch ? titleMatch[1].trim() : skillName,
      description: descMatch ? descMatch[1].trim() : summaryParagraph || `Standard project skill: ${skillName}`,
      summary: summaryParagraph,
      path: skillFile,
    };
  } catch (err) {
    return {
      id: skillName,
      name: skillName,
      description: `Skill: ${skillName}`,
      path: skillFile,
    };
  }
}

/**
 * Derives avatar URL dynamically based on assets available in /assets
 */
function deriveAvatarUrl(agentId, agentName, role, index) {
  const normId = (agentId || '').toLowerCase().replace(/[\-_]/g, '');
  const normRole = (role || '').toLowerCase();
  const combo = `${normId} ${normRole}`;

  if (combo.includes('pm') || combo.includes('projectmanager') || combo.includes('manager') || combo.includes('delivery') || combo.includes('product') || combo.includes('owner')) {
    return '/assets/projectmanager.png';
  }
  if (combo.includes('techlead') || combo.includes('architect') || combo.includes('lead') || combo.includes('principal') || combo.includes('infra') || combo.includes('devops') || combo.includes('cloud') || combo.includes('sre')) {
    return '/assets/techlead.png';
  }
  if (combo.includes('dev') || combo.includes('developer') || combo.includes('engineer') || combo.includes('author') || combo.includes('code') || combo.includes('software') || combo.includes('frontend') || combo.includes('backend') || combo.includes('mobile') || combo.includes('ios') || combo.includes('android')) {
    return '/assets/developer.png';
  }
  if (combo.includes('test') || combo.includes('qa') || combo.includes('quality') || combo.includes('assurance') || combo.includes('security') || combo.includes('audit') || combo.includes('compliance')) {
    return '/assets/qa.png';
  }

  const fallbacks = ['/assets/projectmanager.png', '/assets/techlead.png', '/assets/developer.png', '/assets/qa.png'];
  return fallbacks[index % fallbacks.length];
}

/**
 * Discovers and formats all configured agents dynamically from .agents/agents.json
 * Plug-and-play across any project codebase (iOS, Android, Web, Backend, etc.).
 */
/**
 * Discovers and formats all configured agents dynamically from all found agents.json configs
 * (supports single config, explicit --config path, or merging multi-project/monorepo configs).
 */
function discoverAgents(customProjectDir, explicitConfigPath) {
  const root = customProjectDir || getProjectRoot();
  const configPaths = findAllAgentsConfigFiles(root, explicitConfigPath);

  let rawAgents = [];
  const seenAgentIds = new Set();
  const configSummaries = [];

  if (configPaths.length > 0) {
    for (const configPath of configPaths) {
      try {
        const rawData = fs.readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(rawData);
        const agentsInFile = parsed.agents || [];
        const relPath = path.relative(root, configPath) || path.basename(configPath);
        let addedCount = 0;

        for (const agent of agentsInFile) {
          if (!agent || !agent.id) continue;
          if (!seenAgentIds.has(agent.id)) {
            seenAgentIds.add(agent.id);
            agent._originConfig = relPath;
            rawAgents.push(agent);
            addedCount++;
          }
        }

        configSummaries.push({ path: relPath, count: addedCount, total: agentsInFile.length });
      } catch (err) {
        console.error(`[AgentDiscovery] Error reading agent config at ${configPath}:`, err.message);
      }
    }

    if (configPaths.length === 1) {
      console.info(`[AgentDiscovery] Discovered ${rawAgents.length} agents from: ${configSummaries[0]?.path}`);
    } else if (configPaths.length > 1) {
      console.info(`\n=======================================================`);
      console.info(`🏢 [AgentDiscovery] Multi-Config Discovery: Found ${configPaths.length} agent configs:`);
      configSummaries.forEach((s, idx) => {
        console.info(`   ${idx + 1}. ${s.path} (${s.count} unique agents added)`);
      });
      console.info(`✅ Merged ${rawAgents.length} total unique agents into Virtual Office.`);
      console.info(`=======================================================\n`);
    }
  }

  if (rawAgents.length === 0) {
    console.info(`[AgentDiscovery] No agents config found. Using default 4-role team template.`);
    rawAgents = DEFAULT_FALLBACK_AGENTS;
  }

  // Generate dynamic, non-overlapping office slots for this exact team size
  const slots = generateOfficeSlots(rawAgents.length);

  return rawAgents.map((agent, index) => {
    // Deterministic layout slot and color theme
    const slot = slots[index] || slots[0];
    const palette = CURATED_PALETTES[index % CURATED_PALETTES.length];
    const badge = agent.badge || deriveBadge(agent.id, agent.name);
    const avatarUrl = agent.avatar_url || agent.avatarUrl || deriveAvatarUrl(agent.id, agent.name, agent.role, index);

    const theme = {
      themeColor: palette.themeColor,
      lightColor: palette.lightColor,
      badge,
      hairColor: palette.hairColor,
      skinColor: palette.skinColor,
      clothingColor: palette.clothingColor,
      accessory: palette.accessory,
      station: `${agent.id}-station`,
      stationName: `${agent.name} Station`,
      deskPosition: { ...slot.deskPosition },
      roomBounds: { ...slot.roomBounds },
      avatarUrl,
      facing: slot.facing,
    };

    // Load skills dynamically, checking agent's origin directory first
    const skillSearchDir = agent._originConfig ? path.join(root, path.dirname(agent._originConfig)) : root;
    const skillObjects = (agent.skills || []).map((skillName) => readSkillMetadata(skillName, skillSearchDir));

    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      origin: agent._originConfig || 'root',
      aliases: agent.aliases || [],
      badgeText: theme.badge,
      activeRoleBadge: agent.active_role_badge || `🎭 **Active Role**: **${agent.name}** (\`${agent.id}\`)`,
      description: agent.description,
      skills: skillObjects,
      skillIds: agent.skills || [],
      allowedTools: agent.allowed_tools || [],
      prohibitedActions: agent.prohibited_actions || [],
      delegationTargets: agent.delegation_targets || [],
      theme,
      avatarUrl,
      status: 'available',
      currentTask: null,
      currentFile: null,
      lastTool: null,
      delegatedBy: null,
      parentAgent: index === 0 ? null : (rawAgents[0] ? rawAgents[0].id : null),
      currentPosition: { ...theme.deskPosition },
      targetPosition: { ...theme.deskPosition },
      activityMessage: 'Ready at workstation',
      taskStartedAt: null,
      taskCompletedAt: null,
      taskDurationSec: null,
      totalWorkTimeSec: 0,
      updatedAt: new Date().toISOString(),
    };
  });
}

module.exports = {
  discoverAgents,
  readSkillMetadata,
  findAgentsConfigFile,
  findAllAgentsConfigFiles,
  findSkillsDirectory,
  getProjectRoot,
  PROJECT_ROOT,
  DEFAULT_FALLBACK_AGENTS,
};
