/**
 * Registry Watcher & Auto-Sync Engine
 *
 * Uses chokidar to monitor changes in .agents/registry.* and .agents/definitions/*.md,
 * automatically compiling and updating all adapter outputs with debouncing.
 */

const path = require('path');
const chokidar = require('chokidar');
const { loadRegistry } = require('./canonicalRegistry');
const { syncAll } = require('../adapters');

class RegistryWatcher {
  constructor(projectRoot = process.cwd(), options = {}) {
    this.projectRoot = projectRoot;
    this.options = options;
    this.watcher = null;
    this.debounceTimer = null;
    this.debounceMs = options.debounceMs || 300;
    this.isSyncing = false;
  }

  start(onSyncCallback = null) {
    if (this.watcher) {
      return;
    }

    const watchPaths = [
      path.join(this.projectRoot, '.agents', 'registry.yaml'),
      path.join(this.projectRoot, '.agents', 'registry.json'),
      path.join(this.projectRoot, '.agents', 'definitions', '*.md'),
    ];

    console.info(`[RegistryWatcher] Starting watch on canonical registry files in ${this.projectRoot}...`);

    this.watcher = chokidar.watch(watchPaths, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    const triggerSync = (event, filePath) => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(async () => {
        if (this.isSyncing) return;
        this.isSyncing = true;
        try {
          console.info(`[RegistryWatcher] Detected ${event} on ${path.basename(filePath)}. Triggering provider sync...`);
          const registry = loadRegistry(this.projectRoot);
          if (registry) {
            const syncResult = await syncAll(registry, this.projectRoot, this.options);
            console.info(`[RegistryWatcher] Provider sync complete. ${syncResult.totalFilesWritten} files updated.`);
            if (onSyncCallback) {
              onSyncCallback(syncResult);
            }
          }
        } catch (err) {
          console.error('[RegistryWatcher] Error during auto-sync:', err.message);
        } finally {
          this.isSyncing = false;
        }
      }, this.debounceMs);
    };

    this.watcher.on('add', (filePath) => triggerSync('add', filePath));
    this.watcher.on('change', (filePath) => triggerSync('change', filePath));
    this.watcher.on('unlink', (filePath) => triggerSync('unlink', filePath));
    this.watcher.on('error', (err) => console.error('[RegistryWatcher] Watcher error:', err));
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      console.info('[RegistryWatcher] Stopped registry watcher.');
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}

module.exports = {
  RegistryWatcher,
};
