/**
 * Jira / Confluence access for the read-jira and read-confluence skills.
 * Tokens are looked up where scripts/read_jira.py and scripts/read_confluence.py look (environment,
 * the project's .env.local / .env, `export` lines in ~/.zshrc, ~/.zshenv, ~/.zprofile).
 * Token values never leave the server except in the Authorization header to that same Jira/Confluence host.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

// The scripts are the source of truth for which server they talk to
function scriptBase(script, constant, fallback) {
  try {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', script), 'utf8');
    const m = src.match(new RegExp(`^${constant}\\s*=\\s*["']([^"']+)["']`, 'm'));
    return m ? m[1].replace(/\/$/, '') : fallback;
  } catch (e) {
    return fallback;
  }
}

const INTEGRATIONS = {
  jira: {
    name: 'Jira',
    envVars: ['JIRA_PATH'],
    skill: 'read-jira',
    script: 'read_jira.py',
    flag: '--token',
    example: 'DXDT-25243',
    base: () => scriptBase('read_jira.py', 'JIRA_BASE', ''),
    tokenPage: (base) => `${base}/secure/ViewProfile.jspa?selectedTab=com.atlassian.pats.pats-plugin:jira-user-personal-access-tokens`,
    whoAmI: (base) => `${base}/rest/api/2/myself`,
  },
  confluence: {
    name: 'Confluence',
    envVars: ['CONFLUENCE_PATH', 'CONFLUENCE_PAT', 'ATLASSIAN_PAT'],
    skill: 'read-confluence',
    script: 'read_confluence.py',
    flag: '--pat',
    example: '421200037',
    base: () => scriptBase('read_confluence.py', 'CONFLUENCE_BASE', ''),
    tokenPage: (base) => `${base}/plugins/personalaccesstokens/usertokens.action`,
    whoAmI: (base) => `${base}/rest/api/user/current`,
  },
};

const PLACEHOLDER = /^your_.*_here$/i;

function valueIn(file, names, exportOnly) {
  try {
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
      let line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      if (exportOnly) {
        if (!line.startsWith('export ')) continue;
        line = line.slice('export '.length);
      }
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      // .env.example ships placeholders (your_..._here); a copied but unedited file is not a token
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (names.includes(key) && value && !PLACEHOLDER.test(value)) return value;
    }
  } catch (e) {}
  return null;
}

/** The token and where it came from, or null. Server-side only. */
function findToken(names, projectRoot, homeDir = os.homedir()) {
  for (const n of names) {
    const v = (process.env[n] || '').trim();
    if (v && !PLACEHOLDER.test(v)) return { value: v, source: `environment (${n})` };
  }
  for (const f of ['.env.local', '.env']) {
    const v = valueIn(path.join(projectRoot, f), names, false);
    if (v) return { value: v, source: f };
  }
  for (const f of ['.zshrc', '.zshenv', '.zprofile']) {
    const v = valueIn(path.join(homeDir, f), names, true);
    if (v) return { value: v, source: `~/${f}` };
  }
  return null;
}

/** Status per integration, setup steps, and which roles on the team use it. Never includes the token. */
function integrationStatus(projectRoot, agents = [], homeDir) {
  const result = {};
  for (const [id, cfg] of Object.entries(INTEGRATIONS)) {
    const usedBy = agents
      .filter((a) => (a.skills || []).some((s) => (typeof s === 'string' ? s : s && (s.id || s.name)) === cfg.skill))
      .map((a) => a.id);
    const token = findToken(cfg.envVars, projectRoot, homeDir);
    const base = cfg.base();
    const envVar = cfg.envVars[0];
    result[id] = {
      name: cfg.name,
      configured: Boolean(token),
      source: token ? token.source : null,
      envVar,
      usedBy,
      server: base,
      tokenPage: base ? cfg.tokenPage(base) : null,
      setup: `Add ${envVar}="<token>" to .env.local in the project root (see .env.example), or export ${envVar} in your shell.`,
      steps: {
        envLine: `${envVar}="<your token>"`,
        copyEnv: 'cp .env.example .env.local',
        shell: `export ${envVar}="<your token>"`,
        oneRun: `python3 scripts/${cfg.script} ${cfg.example} ${cfg.flag} <your token>`,
      },
    };
  }
  return result;
}

function getJson(url, token, timeoutMs) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, type: String(res.headers['content-type'] || ''), body }));
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', (err) => resolve({ error: err.message }));
  });
}

/**
 * Signs in once with the stored token and reports who it belongs to, or why it failed.
 * `request` is injectable for tests.
 */
async function testConnection(id, projectRoot, { homeDir, request = getJson, timeoutMs = 8000 } = {}) {
  const cfg = INTEGRATIONS[id];
  if (!cfg) return { ok: false, reason: 'unknown', message: `Unknown integration "${id}".` };
  const token = findToken(cfg.envVars, projectRoot, homeDir);
  if (!token) return { ok: false, reason: 'missing', message: `${cfg.envVars[0]} is not set.` };
  const base = cfg.base();
  if (!base) return { ok: false, reason: 'no_server', message: `No ${cfg.name} server is configured in scripts/${cfg.script}.` };
  const res = await request(cfg.whoAmI(base), token.value, timeoutMs);
  if (res.error) return { ok: false, reason: 'unreachable', message: `Could not reach ${base}: ${res.error}.` };
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'rejected', message: `${cfg.name} rejected the token (HTTP ${res.status}). Create a new one.` };
  if (res.status >= 200 && res.status < 300 && /json/i.test(res.type)) {
    try {
      const me = JSON.parse(res.body);
      const account = me.displayName || me.name || me.username || me.emailAddress || 'your account';
      return { ok: true, reason: 'connected', account, message: `Connected to ${cfg.name} as ${account} (token from ${token.source}).` };
    } catch (e) {}
  }
  if (/html/i.test(res.type)) return { ok: false, reason: 'rejected', message: `${cfg.name} returned a sign-in page instead of data: the token is not valid.` };
  return { ok: false, reason: 'error', message: `${cfg.name} answered HTTP ${res.status}.` };
}

module.exports = { integrationStatus, testConnection };
