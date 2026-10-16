/**
 * Base Provider Adapter for Universal AI Agent Registry
 *
 * Defines the standard lifecycle and interface for multi-provider synchronization.
 */

const fs = require('fs');
const path = require('path');

class BaseAdapter {
  constructor(name, description = '') {
    if (new.target === BaseAdapter) {
      throw new TypeError('Cannot construct BaseAdapter instances directly');
    }
    this.name = name;
    this.description = description;
    this.targetFiles = [];
  }

  /**
   * Compiles the canonical registry into target provider files.
   *
   * @param {object} registry - Canonical registry
   * @param {string} projectRoot - Root directory of the project
   * @param {object} [options] - Generation options (dryRun, etc.)
   * @returns {Promise<{ success: boolean, filesWritten: Array<{ path: string, size: number }>, warnings: string[] }>}
   */
  async generate(registry, projectRoot, options = {}) {
    throw new Error(`generate() must be implemented by adapter ${this.name}`);
  }

  /**
   * Validates if target files exist and are up-to-date with registry.
   *
   * @param {string} projectRoot - Root directory
   * @param {object} registry - Canonical registry
   * @returns {Promise<{ valid: boolean, missingFiles: string[], errors: string[] }>}
   */
  async validate(projectRoot, registry) {
    const missingFiles = [];
    const errors = [];

    for (const relPath of this.targetFiles) {
      const fullPath = path.join(projectRoot, relPath);
      if (!fs.existsSync(fullPath)) {
        missingFiles.push(relPath);
      }
    }

    return {
      valid: missingFiles.length === 0 && errors.length === 0,
      missingFiles,
      errors,
    };
  }

  /**
   * Cleans / removes generated target files.
   *
   * @param {string} projectRoot - Root directory
   * @param {object} [options] - Clean options (dryRun, etc.)
   * @returns {Promise<{ cleanedFiles: string[], skippedFiles: string[] }>}
   */
  async clean(projectRoot, options = {}) {
    const cleanedFiles = [];
    const skippedFiles = [];

    for (const relPath of this.targetFiles) {
      const fullPath = path.join(projectRoot, relPath);
      if (fs.existsSync(fullPath)) {
        if (!options.dryRun) {
          try {
            fs.unlinkSync(fullPath);
            cleanedFiles.push(relPath);
          } catch (e) {
            skippedFiles.push(relPath);
          }
        } else {
          cleanedFiles.push(`[dry-run] ${relPath}`);
        }
      } else {
        skippedFiles.push(relPath);
      }
    }

    return { cleanedFiles, skippedFiles };
  }

  /**
   * Helper to safely write a file, creating parent directories if needed.
   */
  writeFileSafely(fullPath, content, options = {}) {
    if (options.dryRun) {
      return { path: fullPath, size: Buffer.byteLength(content, 'utf8'), dryRun: true };
    }
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, 'utf8');
    return { path: fullPath, size: Buffer.byteLength(content, 'utf8'), dryRun: false };
  }
}

module.exports = BaseAdapter;
