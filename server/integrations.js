/**
 * Jira / Confluence access for the read-jira and read-confluence skills.
 * Tokens are looked up where scripts/read_jira.py and scripts/read_confluence.py look (environment,
 * the project's .env.local / .env, `export` lines in ~/.zshrc, ~/.zshenv, ~/.zprofile).
 * Token values never leave the server except in the Authorization header to the configured Jira/Confluence host.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const INTEGRATIONS = {
  jira: {
    name: 'Jira',
    envVars: ['JIRA_PATH'],
    baseVar: 'JIRA_BASE_URL',
    basePlaceholder: 'https://jira.your-company.com',
    skill: 'read-jira',
    script: 'read_jira.py',
    flag: '--token',
    example: 'PROJ-123',
    tokenPage: (base) => `${base}/secure/ViewProfile.jspa?selectedTab=com.atlassian.pats.pats-plugin:jira-user-personal-access-tokens`,
    whoAmI: (base) => `${base}/rest/api/2/myself`,
  },
  confluence: {
    name: 'Confluence',
    envVars: ['CONFLUENCE_PATH', 'CONFLUENCE_PAT', 'ATLASSIAN_PAT'],
    baseVar: 'CONFLUENCE_BASE_URL',
    basePlaceholder: 'https://confluence.your-company.com',
    skill: 'read-confluence',
    script: 'read_confluence.py',
    flag: '--pat',
    example: '123456',
    tokenPage: (base) => `${base}/plugins/personalaccesstokens/usertokens.action`,
    whoAmI: (base) => `${base}/rest/api/user/current`,
  },
};

// .env.example ships placeholders; an unedited value is not a setting
const PLACEHOLDER = /^your_.*_here$|example\.com|your-company/i;

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

/** A setting (token or server URL) and where it came from, or null. Server-side only. */
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
    const baseSetting = findToken([cfg.baseVar], projectRoot, homeDir);
    const base = baseSetting ? baseSetting.value.replace(/\/$/, '') : null;
    const envVar = cfg.envVars[0];
    result[id] = {
      name: cfg.name,
      configured: Boolean(token && base),
      tokenSet: Boolean(token),
      source: token ? token.source : null,
      // Enough to recognise which token is stored, never enough to use it
      tokenHint: token && token.value.length >= 8 ? `…${token.value.slice(-4)}` : token ? 'set' : null,
      envVar,
      baseVar: cfg.baseVar,
      usedBy,
      server: base,
      tokenPage: base ? cfg.tokenPage(base) : null,
      setup: `Add ${cfg.baseVar}="${cfg.basePlaceholder}" and ${envVar}="<token>" to .env.local in the project root (see .env.example), or export them in your shell.`,
      steps: {
        baseLine: `${cfg.baseVar}="${cfg.basePlaceholder}"`,
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
  const baseSetting = findToken([cfg.baseVar], projectRoot, homeDir);
  if (!baseSetting) return { ok: false, reason: 'no_server', message: `${cfg.baseVar} is not set: add your ${cfg.name} server URL.` };
  const base = baseSetting.value.replace(/\/$/, '');
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

/** Sets, replaces or removes `KEY="value"` lines in an env file, keeping everything else as is. */
function writeEnvValues(file, values) {
  let lines = [];
  try {
    lines = fs.readFileSync(file, 'utf8').split('\n');
  } catch (e) {}
  for (const [key, value] of Object.entries(values)) {
    const at = lines.findIndex((l) => new RegExp(`^\\s*(export\\s+)?${key}\\s*=`).test(l));
    const line = `${key}="${value}"`;
    if (value === null) {
      if (at >= 0) lines.splice(at, 1);
    } else if (at >= 0) {
      lines[at] = line;
    } else {
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
      lines.push(line, '');
    }
  }
  fs.writeFileSync(file, lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
  // The mode only applies when the file is created; tokens live here, so keep it private either way
  try {
    fs.chmodSync(file, 0o600);
  } catch (e) {}
}

/** Makes sure the project's .gitignore keeps .env.local out of git. */
function ensureGitignored(projectRoot, entry = '.env.local') {
  const file = path.join(projectRoot, '.gitignore');
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {}
  const covered = text.split('\n').some((l) => ['.env.local', '.env*.local', '.env*', '*.local'].includes(l.trim()));
  if (!covered) fs.writeFileSync(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${entry}\n`, 'utf8');
}

/**
 * Saves an integration's server URL and/or token into the project's .env.local (where the
 * scripts read them). `clear: true` removes both. Returns an error message or null.
 */
function saveSettings(id, projectRoot, { baseUrl, token, clear } = {}) {
  const cfg = INTEGRATIONS[id];
  if (!cfg) return `Unknown integration "${id}".`;
  const values = {};
  if (clear) {
    values[cfg.baseVar] = null;
    values[cfg.envVars[0]] = null;
  } else {
    if (baseUrl !== undefined && baseUrl !== '') {
      let url;
      try {
        url = new URL(String(baseUrl).trim());
      } catch (e) {
        return 'Enter the full server URL, e.g. https://jira.your-company.com';
      }
      if (!/^https?:$/.test(url.protocol)) return 'The server URL must start with https:// (or http://).';
      if (PLACEHOLDER.test(url.hostname)) return 'Replace the example address with your own server.';
      values[cfg.baseVar] = url.toString().replace(/\/$/, '');
    }
    if (token !== undefined && token !== '') {
      const t = String(token).trim();
      if (!t || /[\s"'\\]/.test(t)) return 'The token cannot contain spaces, quotes or backslashes.';
      values[cfg.envVars[0]] = t;
    }
    if (!Object.keys(values).length) return 'Enter a server URL, a token, or both.';
  }
  ensureGitignored(projectRoot);
  writeEnvValues(path.join(projectRoot, '.env.local'), values);
  return null;
}

/** The configured server URL for an integration, or null (used to link tickets and pages). */
function serverUrl(id, projectRoot, homeDir) {
  const cfg = INTEGRATIONS[id];
  const found = cfg ? findToken([cfg.baseVar], projectRoot, homeDir) : null;
  return found ? found.value.replace(/\/$/, '') : null;
}

module.exports = { integrationStatus, testConnection, serverUrl, saveSettings };
