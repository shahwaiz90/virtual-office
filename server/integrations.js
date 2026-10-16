/**
 * Whether the Jira / Confluence tokens the read-jira and read-confluence skills need are set.
 * Looks where scripts/read_jira.py and scripts/read_confluence.py look: the environment, the project's
 * .env.local / .env, and `export` lines in ~/.zshrc, ~/.zshenv, ~/.zprofile. Never returns the values.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const INTEGRATIONS = {
  jira: { envVars: ['JIRA_PATH'], skill: 'read-jira', file: '.env.local', example: 'JIRA_PATH="<token>"' },
  confluence: { envVars: ['CONFLUENCE_PATH', 'CONFLUENCE_PAT', 'ATLASSIAN_PAT'], skill: 'read-confluence', file: '.env.local', example: 'CONFLUENCE_PATH="<token>"' },
};

function declaredIn(file, names, exportOnly) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.split('\n').some((raw) => {
      let line = raw.trim();
      if (exportOnly) {
        if (!line.startsWith('export ')) return false;
        line = line.slice('export '.length);
      }
      const eq = line.indexOf('=');
      if (eq < 0 || line.startsWith('#')) return false;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      // .env.example ships placeholders (your_..._here); a copied but unedited file is not a token
      return names.includes(key) && value.length > 0 && !/^your_.*_here$/i.test(value);
    });
  } catch (e) {
    return false;
  }
}

function isConfigured(names, projectRoot, homeDir = os.homedir()) {
  if (names.some((n) => (process.env[n] || '').trim())) return true;
  if (['.env.local', '.env'].some((f) => declaredIn(path.join(projectRoot, f), names, false))) return true;
  return ['.zshrc', '.zshenv', '.zprofile'].some((f) => declaredIn(path.join(homeDir, f), names, true));
}

/** Status per integration, and which roles on the team use it. */
function integrationStatus(projectRoot, agents = [], homeDir) {
  const result = {};
  for (const [id, cfg] of Object.entries(INTEGRATIONS)) {
    const usedBy = agents
      .filter((a) => (a.skills || []).some((s) => (typeof s === 'string' ? s : s && (s.id || s.name)) === cfg.skill))
      .map((a) => a.id);
    result[id] = {
      configured: isConfigured(cfg.envVars, projectRoot, homeDir),
      envVar: cfg.envVars[0],
      usedBy,
      setup: `Add ${cfg.example} to ${cfg.file} in the project root (see .env.example), or export ${cfg.envVars[0]} in your shell.`,
    };
  }
  return result;
}

module.exports = { integrationStatus };
