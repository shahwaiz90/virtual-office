const fs = require('fs');
const path = require('path');

let runtimeProjectRoot = null;

function setProjectRoot(newPath) {
  if (newPath) {
    runtimeProjectRoot = path.resolve(newPath);
    return runtimeProjectRoot;
  }
  return null;
}

/**
 * Resolves the target project directory from:
 * 0. Dynamically set runtime project root (via UI or API)
 * 1. CLI argument (--dir, -d, --project)
 * 2. Environment variable (PROJECT_DIR, AGENTS_PROJECT_DIR, AGENTS_DIR)
 * 3. Current working directory (if .agents or agents.json exists, or fallback)
 * 4. Workspace repository root (2 levels up from server/)
 */
function getProjectRoot() {
  if (runtimeProjectRoot) {
    return runtimeProjectRoot;
  }

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

  // If direct config files exist in target root, return them immediately
  if (fileSet.size > 0) {
    return Array.from(fileSet);
  }

  // 2. Deep recursive scan of all folders in root directory
  const scanned = scanForAllAgentsConfigs(root);
  for (const file of scanned) {
    fileSet.add(path.resolve(file));
  }

  if (fileSet.size > 0) {
    return Array.from(fileSet);
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
  if (!count || count <= 0) return [];
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

  if (combo.includes('design') || combo.includes('ux') || combo.includes('ui') || combo.includes('visual') || combo.includes('creative') || combo.includes('art')) {
    return '/assets/designer.png';
  }
  if (combo.includes('devops') || combo.includes('sre') || combo.includes('cloud') || combo.includes('infra') || combo.includes('platform') || combo.includes('ci')) {
    return '/assets/devops.png';
  }
  if (combo.includes('sec') || combo.includes('security') || combo.includes('compliance') || combo.includes('audit') || combo.includes('privacy') || combo.includes('guard')) {
    return '/assets/security.png';
  }
  if (combo.includes('scrum') || combo.includes('agile') || combo.includes('coach') || combo.includes('kanban') || combo.includes('sprint')) {
    return '/assets/scrummaster.png';
  }
  if (combo.includes('data') || combo.includes('ai') || combo.includes('ml') || combo.includes('analytics') || combo.includes('scientist') || combo.includes('research') || combo.includes('bi')) {
    return '/assets/dataengineer.png';
  }
  if (combo.includes('mobile') || combo.includes('ios') || combo.includes('android') || combo.includes('flutter') || combo.includes('reactnative') || combo.includes('swift') || combo.includes('kotlin')) {
    return '/assets/mobiledev.png';
  }
  if (combo.includes('writer') || combo.includes('doc') || combo.includes('documentation') || combo.includes('content') || combo.includes('techwriter')) {
    return '/assets/writer.png';
  }
  if (combo.includes('pm') || combo.includes('projectmanager') || combo.includes('manager') || combo.includes('delivery') || combo.includes('product') || combo.includes('owner')) {
    return '/assets/projectmanager.png';
  }
  if (combo.includes('techlead') || combo.includes('architect') || combo.includes('lead') || combo.includes('principal')) {
    return '/assets/techlead.png';
  }
  if (combo.includes('test') || combo.includes('qa') || combo.includes('quality') || combo.includes('assurance')) {
    return '/assets/qa.png';
  }
  if (combo.includes('dev') || combo.includes('developer') || combo.includes('engineer') || combo.includes('author') || combo.includes('code') || combo.includes('software') || combo.includes('frontend') || combo.includes('backend')) {
    return '/assets/developer.png';
  }

  const fallbacks = [
    '/assets/projectmanager.png',
    '/assets/techlead.png',
    '/assets/developer.png',
    '/assets/qa.png',
    '/assets/designer.png',
    '/assets/devops.png',
    '/assets/security.png',
    '/assets/scrummaster.png',
    '/assets/dataengineer.png',
    '/assets/mobiledev.png',
    '/assets/writer.png',
    '/assets/architect_female.png',
    '/assets/frontend_female.png',
    '/assets/ai_female.png'
  ];
  return fallbacks[index % fallbacks.length];
}

/**
 * Robust extractor for agent definitions written in Markdown with frontmatter,
 * Markdown bullet points, or YAML files.
 */
function parseFrontmatterAndMarkdown(content, fallbackId) {
  if (!content) return null;

  const result = {
    id: fallbackId,
    name: '',
    role: '',
    description: '',
    skills: [],
    delegation_targets: [],
    allowed_tools: [],
    prohibited_actions: [],
  };

  // 1. Check for YAML frontmatter (between --- and ---)
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const yamlContent = fmMatch ? fmMatch[1] : '';
  const bodyContent = fmMatch ? content.slice(fmMatch[0].length).trim() : content.trim();

  const textToParse = yamlContent || content;
  const lines = textToParse.split(/\r?\n/);
  let currentArrayKey = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) continue;

    if (trimmed.startsWith('#')) {
      const heading = trimmed.replace(/^#+\s*/, '').toLowerCase().replace(/[\-_]/g, ' ').trim();
      if (heading.startsWith('skill')) {
        currentArrayKey = 'skills';
      } else if (heading.includes('delegat')) {
        currentArrayKey = 'delegation_targets';
      } else if (heading.includes('tool')) {
        currentArrayKey = 'allowed_tools';
      } else if (heading.includes('prohibit')) {
        currentArrayKey = 'prohibited_actions';
      } else if (!result.name && trimmed.startsWith('# ')) {
        result.name = trimmed.replace(/^#\s+/, '').trim();
      }
      continue;
    }

    // Array item: - item
    if (trimmed.startsWith('- ') && currentArrayKey) {
      const val = trimmed.replace(/^-\s+/, '').replace(/^["']|["']$/g, '').trim();
      if (val) {
        if (!Array.isArray(result[currentArrayKey])) {
          result[currentArrayKey] = [];
        }
        result[currentArrayKey].push(val);
      }
      continue;
    }

    // Key-value pair: key: value or **Key**: value
    const kvMatch = trimmed.match(/^(\*{0,2})([a-zA-Z0-9_\-]+)\1\s*:\s*(.*)$/);
    if (kvMatch) {
      const rawKey = kvMatch[2].toLowerCase().replace(/[\-_]/g, '_');
      const val = kvMatch[3].replace(/^["']|["']$/g, '').trim();

      if (rawKey === 'id') {
        if (val) result.id = val;
        currentArrayKey = null;
      } else if (rawKey === 'name') {
        if (val) result.name = val;
        currentArrayKey = null;
      } else if (rawKey === 'role' || rawKey === 'title' || rawKey === 'active_role') {
        if (val) result.role = val;
        currentArrayKey = null;
      } else if (rawKey === 'description' || rawKey === 'desc' || rawKey === 'summary') {
        if (val) result.description = val;
        currentArrayKey = null;
      } else if (rawKey === 'skills' || rawKey === 'skill_ids' || rawKey === 'skill') {
        currentArrayKey = 'skills';
        if (val) {
          const items = val.replace(/^\[|\]$/g, '').split(',').map((s) => s.replace(/^["']|["']$/g, '').trim()).filter(Boolean);
          if (items.length > 0) result.skills = items;
        }
      } else if (rawKey === 'delegation_targets' || rawKey === 'delegationtargets' || rawKey === 'delegates_to' || rawKey === 'delegates' || rawKey === 'handoff_to' || rawKey === 'handoffto') {
        currentArrayKey = 'delegation_targets';
        if (val) {
          const items = val.replace(/^\[|\]$/g, '').split(',').map((s) => s.replace(/^["']|["']$/g, '').trim()).filter(Boolean);
          if (items.length > 0) {
            result.delegation_targets = items;
            result.handoffTo = items;
          }
        }
      } else if (rawKey === 'allowed_tools' || rawKey === 'tools') {
        currentArrayKey = 'allowed_tools';
        if (val) {
          const items = val.replace(/^\[|\]$/g, '').split(',').map((s) => s.replace(/^["']|["']$/g, '').trim()).filter(Boolean);
          if (items.length > 0) {
            result.allowed_tools = items;
            result.tools = items;
          }
        }
      } else if (rawKey === 'prohibited_actions') {
        currentArrayKey = 'prohibited_actions';
        if (val) {
          const items = val.replace(/^\[|\]$/g, '').split(',').map((s) => s.replace(/^["']|["']$/g, '').trim()).filter(Boolean);
          if (items.length > 0) result.prohibited_actions = items;
        }
      } else if (rawKey === 'permissions') {
        currentArrayKey = 'permissions';
        if (val) {
          const items = val.replace(/^\[|\]$/g, '').split(',').map((s) => s.replace(/^["']|["']$/g, '').trim()).filter(Boolean);
          if (items.length > 0) result.permissions = items;
        }
      } else if (rawKey === 'persona') {
        if (val) result.persona = val;
        currentArrayKey = null;
      } else if (rawKey === 'goal') {
        if (val) result.goal = val;
        currentArrayKey = null;
      } else if (rawKey === 'input_contract' || rawKey === 'inputcontract') {
        if (val) result.inputContract = val;
        currentArrayKey = null;
      } else if (rawKey === 'output_contract' || rawKey === 'outputcontract') {
        if (val) result.outputContract = val;
        currentArrayKey = null;
      } else if (rawKey === 'reports_to' || rawKey === 'reportsto') {
        if (val) result.reportsTo = val;
        currentArrayKey = null;
      } else if (rawKey === 'badge') {
        if (val) result.badge = val;
        currentArrayKey = null;
      } else {
        currentArrayKey = null;
      }
    }
  }

  // If description was not in frontmatter, extract the first paragraph of body
  if (!result.description && bodyContent) {
    const bodyLines = bodyContent.split(/\r?\n/);
    for (const line of bodyLines) {
      const tr = line.trim();
      if (tr && !tr.startsWith('#') && !tr.startsWith('-') && !tr.startsWith('```') && !tr.startsWith('>')) {
        result.description = tr;
        break;
      }
    }
  }

  if (!result.name) {
    result.name = fallbackId.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (!result.role) {
    result.role = result.name;
  }

  return result;
}

/**
 * Parses individual agent JSON files (supports single agent object, { agent: {...} }, or { agents: [...] })
 */
function parseAgentJsonFile(filePath, fallbackId) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed) return [];

    if (Array.isArray(parsed.agents)) {
      return parsed.agents.filter((a) => a && (a.id || a.name || a.role));
    }
    if (Array.isArray(parsed)) {
      return parsed.filter((a) => a && (a.id || a.name || a.role));
    }
    if (parsed.agent && typeof parsed.agent === 'object') {
      const a = parsed.agent;
      if (!a.id) a.id = fallbackId;
      return [a];
    }
    if (parsed.id || parsed.role || parsed.name) {
      if (!parsed.id) parsed.id = fallbackId;
      return [parsed];
    }
    return [];
  } catch (err) {
    return [];
  }
}

/**
 * Scans candidate agent directories looking for individual agent files (.json, .yaml, .yml, .md)
 * or subdirectories when no single agents.json exists, or to discover additional agents in folders.
 */
function discoverAgentsFromFolders(customRoot) {
  const root = customRoot || getProjectRoot();
  const candidateDirNames = [
    '.agents',
    'agents',
    '.opencode/agents',
    'opencode/agents',
    '.claude/agents',
    'config/agents',
    '.cursor/agents',
  ];

  const candidateDirs = new Set();
  for (const c of candidateDirNames) {
    const full = path.join(root, c);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      candidateDirs.add(full);
    }
  }

  // Search for any nested directory named "agents" or ".agents" (maxDepth 3)
  const queue = [[root, 0]];
  while (queue.length > 0) {
    const [dir, depth] = queue.shift();
    if (depth >= 3) continue;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !IGNORED_SCAN_DIRS.has(entry.name) && !entry.name.startsWith('.git')) {
          const lower = entry.name.toLowerCase();
          const fullPath = path.join(dir, entry.name);
          if (lower === 'agents' || lower === '.agents') {
            candidateDirs.add(fullPath);
          } else {
            queue.push([fullPath, depth + 1]);
          }
        }
      }
    } catch (e) {}
  }

  const discoveredAgents = [];
  const seenIds = new Set();

  for (const dir of candidateDirs) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const baseName = path.parse(entry.name).name;
        const lowerName = entry.name.toLowerCase();

        // Skip non-agent directories or special internal folders
        if (entry.name.startsWith('.') || lowerName === 'skills' || lowerName === 'scratch' || lowerName === 'node_modules') {
          continue;
        }

        // Case 1: Individual file directly in agents folder
        if (entry.isFile()) {
          // If it is agents.json, it is handled by config file scanner
          if (lowerName === 'agents.json' || lowerName === 'agents_config.json' || lowerName === 'opencode_agents.json') {
            continue;
          }

          if (lowerName.endsWith('.json')) {
            const parsedList = parseAgentJsonFile(fullPath, baseName);
            for (const a of parsedList) {
              const id = a.id || baseName;
              if (!seenIds.has(id)) {
                seenIds.add(id);
                a.id = id;
                a._originConfig = path.relative(root, fullPath) || path.basename(fullPath);
                discoveredAgents.push(a);
              }
            }
          } else if (lowerName.endsWith('.yaml') || lowerName.endsWith('.yml') || lowerName.endsWith('.md')) {
            if (lowerName === 'readme.md' && !entry.name.toLowerCase().includes('agent')) continue;
            try {
              const content = fs.readFileSync(fullPath, 'utf8');
              const agentObj = parseFrontmatterAndMarkdown(content, baseName);
              if (agentObj && (agentObj.role || agentObj.skills.length > 0 || agentObj.delegation_targets.length > 0)) {
                const id = agentObj.id || baseName;
                if (!seenIds.has(id)) {
                  seenIds.add(id);
                  agentObj._originConfig = path.relative(root, fullPath) || path.basename(fullPath);
                  discoveredAgents.push(agentObj);
                }
              }
            } catch (e) {}
          }
        }

        // Case 2: Subdirectory representing an individual agent (e.g. .agents/project-manager/agent.json or agent.md)
        if (entry.isDirectory()) {
          try {
            const subEntries = fs.readdirSync(fullPath, { withFileTypes: true });
            for (const sub of subEntries) {
              if (!sub.isFile()) continue;
              const subLower = sub.name.toLowerCase();
              const subFilePath = path.join(fullPath, sub.name);

              if (subLower.endsWith('.json')) {
                const parsedList = parseAgentJsonFile(subFilePath, baseName);
                for (const a of parsedList) {
                  const id = a.id || baseName;
                  if (!seenIds.has(id)) {
                    seenIds.add(id);
                    a.id = id;
                    a._originConfig = path.relative(root, subFilePath) || path.basename(subFilePath);
                    discoveredAgents.push(a);
                  }
                }
              } else if (subLower.endsWith('.yaml') || subLower.endsWith('.yml') || subLower.endsWith('.md')) {
                try {
                  const content = fs.readFileSync(subFilePath, 'utf8');
                  const agentObj = parseFrontmatterAndMarkdown(content, baseName);
                  if (agentObj && (agentObj.role || agentObj.skills.length > 0 || agentObj.delegation_targets.length > 0)) {
                    const id = agentObj.id || baseName;
                    if (!seenIds.has(id)) {
                      seenIds.add(id);
                      agentObj._originConfig = path.relative(root, subFilePath) || path.basename(subFilePath);
                      discoveredAgents.push(agentObj);
                    }
                  }
                } catch (e) {}
              }
            }
          } catch (e) {}
        }
      }
    } catch (err) {}
  }

  return discoveredAgents;
}

/**
 * Discovers and formats all configured agents dynamically from all found agents.json configs
 * or individual agent files defined in .agents/ or agents/ folders.
 */
function discoverAgents(customProjectDir, explicitConfigPath) {
  const root = customProjectDir || getProjectRoot();
  const configPaths = findAllAgentsConfigFiles(root, explicitConfigPath);

  let rawAgents = [];
  const seenAgentIds = new Set();
  const configSummaries = [];

  // 1. Discover agents from single/monorepo agents.json configs
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

  // 2. Discover agents from agents/ or .agents/ folders ONLY if no agents were found in agents.json config files
  if (rawAgents.length === 0) {
    const folderAgents = discoverAgentsFromFolders(root);
    let folderAddedCount = 0;
    for (const agent of folderAgents) {
      if (!agent || !agent.id) continue;
      if (!seenAgentIds.has(agent.id)) {
        seenAgentIds.add(agent.id);
        rawAgents.push(agent);
        folderAddedCount++;
      }
    }

    if (folderAddedCount > 0) {
      console.info(`[AgentDiscovery] Discovered ${folderAddedCount} agents from agents folder(s).`);
    }
  }

  if (rawAgents.length === 0) {
    console.info(`[AgentDiscovery] No agents config found in: ${root}. Returning 0 agents.`);
    return [];
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

    const isPrimary = Boolean(agent.is_primary !== undefined ? agent.is_primary : (agent.isPrimary !== undefined ? agent.isPrimary : index === 0));
    const primaryAgentId = rawAgents.find(a => a.is_primary || a.isPrimary)?.id || rawAgents[0]?.id || null;

    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      origin: agent._originConfig || 'root',
      aliases: agent.aliases || [],
      badgeText: theme.badge,
      badge: theme.badge,
      activeRoleBadge: agent.active_role_badge || `🎭 **Active Role**: **${agent.name}** (\`${agent.id}\`)`,
      description: agent.description,
      skills: skillObjects,
      skillIds: agent.skills || [],
      allowedTools: agent.allowed_tools || [],
      enable_subagent_tools: agent.enable_subagent_tools !== undefined ? agent.enable_subagent_tools : (agent.allowed_tools || []).includes('invoke_subagent'),
      enable_write_tools: agent.enable_write_tools !== undefined ? agent.enable_write_tools : (agent.allowed_tools || []).some(t => ['write_to_file', 'replace_file_content', 'run_command', 'git_diff'].includes(t)),
      enable_mcp_tools: agent.enable_mcp_tools !== undefined ? agent.enable_mcp_tools : false,
      prohibitedActions: agent.prohibited_actions || [],
      delegationTargets: agent.delegation_targets || agent.delegationTargets || [],
      delegation_targets: agent.delegation_targets || agent.delegationTargets || [],
      isPrimary,
      is_primary: isPrimary,
      isSubagent: !isPrimary,
      is_subagent: !isPrimary,
      theme: { ...theme, isPrimary },
      avatarUrl,
      status: 'available',
      currentTask: null,
      currentFile: null,
      lastTool: null,
      delegatedBy: null,
      parentAgent: isPrimary ? null : primaryAgentId,
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

/**
 * Generates in-memory ghost agents for demo simulation when workspace has 0 configured agents.
 * Strictly in-memory with zero disk pollution.
 */
function generateGhostAgents() {
  const slots = generateOfficeSlots(4);
  const ghostSpecs = [
    {
      id: 'tech-pm',
      name: 'Scrum Master',
      role: 'Scrum Master',
      badgeText: 'PM',
      badge: 'PM',
      avatarUrl: '/assets/pm.png',
      isPrimary: true,
      is_primary: true,
      description: 'Facilitates agile ceremony, user story intake, and Definition of Done verification.',
      skills: [
        { id: 'sprint-planning', name: 'Sprint Planning', description: 'Sprint backlog ingestion & DoD verification' },
        { id: 'backlog-grooming', name: 'Backlog Grooming', description: 'Scrum facilitation and agile delivery' },
      ],
      skillIds: ['sprint-planning', 'backlog-grooming'],
      allowedTools: ['read_file', 'write_to_file', 'run_command', 'git_diff'],
    },
    {
      id: 'tech-lead',
      name: 'Technical Lead',
      role: 'Technical Lead',
      badgeText: 'LEAD',
      badge: 'LEAD',
      avatarUrl: '/assets/techlead.png',
      isPrimary: false,
      is_primary: false,
      description: 'Technical lead responsible for architecture boundaries, interface contracts, and code reviews.',
      skills: [
        { id: 'architecture-review', name: 'Architecture Review', description: 'System boundaries & API specifications' },
        { id: 'contract-boundaries', name: 'Contract Boundaries', description: 'System boundary architecture spike' },
      ],
      skillIds: ['architecture-review', 'contract-boundaries'],
      allowedTools: ['read_file', 'write_to_file', 'run_command', 'git_diff', 'invoke_subagent'],
    },
    {
      id: 'core-dev',
      name: 'Feature Developer',
      role: 'Feature Developer',
      badgeText: 'DEV',
      badge: 'DEV',
      avatarUrl: '/assets/developer.png',
      isPrimary: false,
      is_primary: false,
      description: 'Core software engineer responsible for feature implementation and test-driven development.',
      skills: [
        { id: 'feature-implementation', name: 'Feature Implementation', description: 'TDD feature implementation' },
        { id: 'unit-testing', name: 'Unit Testing', description: 'Local unit and integration test coverage' },
      ],
      skillIds: ['feature-implementation', 'unit-testing'],
      allowedTools: ['read_file', 'write_to_file', 'run_command', 'git_diff'],
    },
    {
      id: 'mobile-qa',
      name: 'QA Tester',
      role: 'QA Tester',
      badgeText: 'QA',
      badge: 'QA',
      avatarUrl: '/assets/qa.png',
      isPrimary: false,
      is_primary: false,
      description: 'QA engineer responsible for automated testing, regression suites, and acceptance verification.',
      skills: [
        { id: 'test-automation', name: 'Test Automation', description: 'Automated test suite execution' },
        { id: 'regression-testing', name: 'Regression Testing', description: 'Regression verification & DoD certification' },
      ],
      skillIds: ['test-automation', 'regression-testing'],
      allowedTools: ['read_file', 'run_command', 'git_diff'],
    },
  ];

  return ghostSpecs.map((spec, index) => {
    const slot = slots[index] || slots[0];
    const palette = CURATED_PALETTES[index % CURATED_PALETTES.length];
    const theme = {
      themeColor: palette.themeColor,
      lightColor: palette.lightColor,
      badge: spec.badge,
      hairColor: palette.hairColor,
      skinColor: palette.skinColor,
      clothingColor: palette.clothingColor,
      accessory: palette.accessory,
      station: `${spec.id}-station`,
      stationName: `${spec.name} Station`,
      deskPosition: { ...slot.deskPosition },
      roomBounds: { ...slot.roomBounds },
      avatarUrl: spec.avatarUrl,
      facing: slot.facing,
      isPrimary: spec.isPrimary,
    };

    return {
      id: spec.id,
      name: spec.name,
      role: spec.role,
      origin: 'in-memory-ghost',
      aliases: [],
      badgeText: spec.badgeText,
      badge: spec.badge,
      activeRoleBadge: `🎭 **Active Role**: **${spec.name}** (\`${spec.id}\`)`,
      description: spec.description,
      skills: spec.skills,
      skillIds: spec.skillIds,
      allowedTools: spec.allowedTools,
      enable_subagent_tools: spec.id === 'tech-lead',
      enable_write_tools: true,
      enable_mcp_tools: false,
      prohibitedActions: [],
      delegationTargets: [],
      delegation_targets: [],
      isPrimary: spec.isPrimary,
      is_primary: spec.is_primary,
      isSubagent: !spec.isPrimary,
      is_subagent: !spec.isPrimary,
      theme,
      avatarUrl: spec.avatarUrl,
      status: 'available',
      currentTask: null,
      currentFile: null,
      lastTool: null,
      delegatedBy: null,
      parentAgent: spec.isPrimary ? null : 'tech-pm',
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
  discoverAgentsFromFolders,
  parseFrontmatterAndMarkdown,
  readSkillMetadata,
  findAgentsConfigFile,
  findAllAgentsConfigFiles,
  findSkillsDirectory,
  getProjectRoot,
  setProjectRoot,
  PROJECT_ROOT,
  DEFAULT_FALLBACK_AGENTS,
  generateOfficeSlots,
  CURATED_PALETTES,
  generateGhostAgents,
};
