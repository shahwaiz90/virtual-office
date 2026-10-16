/**
 * Provider Adapters Index
 *
 * Central export and coordinator for all multi-provider adapters.
 */

const BaseAdapter = require('./baseAdapter');
const OpenCodeAdapter = require('./opencodeAdapter');
const ClaudeAdapter = require('./claudeAdapter');
const CodexAdapter = require('./codexAdapter');
const GeminiAdapter = require('./geminiAdapter');

const adapters = {
  opencode: new OpenCodeAdapter(),
  claude: new ClaudeAdapter(),
  codex: new CodexAdapter(),
  gemini: new GeminiAdapter(),
};

function getAllAdapters() {
  return Object.values(adapters);
}

function getAdapter(name) {
  if (!name) return null;
  return adapters[name.toLowerCase()] || null;
}

/**
 * Synchronizes all or specified adapters.
 *
 * @param {object} registry - Canonical registry
 * @param {string} projectRoot - Root directory
 * @param {object} [options] - Options: { framework: 'all' | 'opencode' | ..., dryRun: boolean }
 * @returns {Promise<{ results: Record<string, any>, totalFilesWritten: number }>}
 */
async function syncAll(registry, projectRoot, options = {}) {
  const framework = options.framework || registry.default_framework || 'all';
  const targetAdapters = framework === 'all'
    ? getAllAdapters()
    : [getAdapter(framework)].filter(Boolean);

  if (targetAdapters.length === 0) {
    throw new Error(`Unknown framework adapter: "${framework}". Available: all, ${Object.keys(adapters).join(', ')}`);
  }

  const results = {};
  let totalFilesWritten = 0;

  for (const adapter of targetAdapters) {
    const res = await adapter.generate(registry, projectRoot, options);
    results[adapter.name] = res;
    if (res && res.filesWritten) {
      totalFilesWritten += res.filesWritten.length;
    }
  }

  return {
    framework,
    results,
    totalFilesWritten,
  };
}

/**
 * Cleans generated files for all or specified adapters.
 */
async function cleanAll(projectRoot, options = {}) {
  const framework = options.framework || 'all';
  const targetAdapters = framework === 'all'
    ? getAllAdapters()
    : [getAdapter(framework)].filter(Boolean);

  if (targetAdapters.length === 0) {
    throw new Error(`Unknown framework adapter: "${framework}". Available: all, ${Object.keys(adapters).join(', ')}`);
  }

  const results = {};
  for (const adapter of targetAdapters) {
    results[adapter.name] = await adapter.clean(projectRoot, options);
  }

  return results;
}

module.exports = {
  BaseAdapter,
  OpenCodeAdapter,
  ClaudeAdapter,
  CodexAdapter,
  GeminiAdapter,
  adapters,
  getAllAdapters,
  getAdapter,
  syncAll,
  cleanAll,
};
