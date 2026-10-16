const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const child_process = require('child_process');

/**
 * Instance Registry & Process Tracking for AI Agent Virtual Office
 *
 * Maintains a lightweight registry in ~/.virtual-office/instances.json:
 * {
 *   "/Users/.../Desktop/Virtual Office": { "port": 3000, "pid": 82622, "startedAt": "..." },
 *   "/Users/.../EasyQuran/QuranSikho": { "port": 3001, "pid": 84120, "startedAt": "..." }
 * }
 */

const REGISTRY_DIR = path.join(os.homedir(), '.virtual-office');
const REGISTRY_FILE = path.join(REGISTRY_DIR, 'instances.json');

function getRegistryPath() {
  return REGISTRY_FILE;
}

function ensureRegistryDir() {
  if (!fs.existsSync(REGISTRY_DIR)) {
    try {
      fs.mkdirSync(REGISTRY_DIR, { recursive: true });
    } catch (e) {
      // Ignore directory creation errors if already exists
    }
  }
}

/**
 * Check if a process ID is currently running on the operating system
 */
function isProcessAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Read instance registry and automatically prune stale dead processes
 */
function readRegistry() {
  ensureRegistryDir();
  if (!fs.existsSync(REGISTRY_FILE)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(REGISTRY_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    // Prune stale / terminated instances
    let modified = false;
    const cleaned = {};

    for (const [projectPath, info] of Object.entries(parsed)) {
      if (info && typeof info.pid === 'number' && isProcessAlive(info.pid)) {
        cleaned[projectPath] = info;
      } else {
        modified = true;
      }
    }

    if (modified) {
      writeRegistry(cleaned);
    }

    return cleaned;
  } catch (err) {
    return {};
  }
}

/**
 * Write instance registry safely to disk
 */
function writeRegistry(registry) {
  ensureRegistryDir();
  try {
    const jsonStr = JSON.stringify(registry, null, 2);
    fs.writeFileSync(REGISTRY_FILE, jsonStr, 'utf-8');
    return true;
  } catch (err) {
    console.error('[InstanceRegistry] Failed to write instances.json:', err.message);
    return false;
  }
}

/**
 * Register or update an active Virtual Office instance
 */
function registerInstance(projectPath, port, pid = process.pid) {
  if (!projectPath) return;
  const normalized = path.resolve(projectPath);
  const registry = readRegistry();

  // If another entry had the exact same port or PID from an old dead run, clean it
  for (const [p, info] of Object.entries(registry)) {
    if (p !== normalized && (info.port === Number(port) || info.pid === Number(pid))) {
      delete registry[p];
    }
  }

  registry[normalized] = {
    port: Number(port),
    pid: Number(pid),
    startedAt: new Date().toISOString(),
  };

  writeRegistry(registry);
  return registry[normalized];
}

/**
 * Remove an instance from the registry (by project path, port, or current pid)
 */
function unregisterInstance(projectPath, port = null) {
  const registry = readRegistry();
  let changed = false;

  if (projectPath) {
    const normalized = path.resolve(projectPath);
    if (registry[normalized]) {
      delete registry[normalized];
      changed = true;
    }
  }

  if (port) {
    const portNum = Number(port);
    for (const [p, info] of Object.entries(registry)) {
      if (info.port === portNum) {
        delete registry[p];
        changed = true;
      }
    }
  }

  // Also remove current pid if present
  for (const [p, info] of Object.entries(registry)) {
    if (info.pid === process.pid) {
      delete registry[p];
      changed = true;
    }
  }

  if (changed) {
    writeRegistry(registry);
  }
}

/**
 * Update an existing instance's watched project path (e.g. when changing directory)
 */
function updateInstancePath(oldPath, newPath, port, pid = process.pid) {
  const registry = readRegistry();
  if (oldPath) {
    delete registry[path.resolve(oldPath)];
  }
  const normalizedNew = path.resolve(newPath);
  registry[normalizedNew] = {
    port: Number(port),
    pid: Number(pid),
    startedAt: new Date().toISOString(),
  };
  writeRegistry(registry);
}

/**
 * Find registered instance info for a given project directory
 */
function getInstanceForProject(projectPath) {
  if (!projectPath) return null;
  const normalized = path.resolve(projectPath);
  const registry = readRegistry();
  return registry[normalized] || null;
}

/**
 * Get all active registered instances
 */
function getAllInstances() {
  return readRegistry();
}

/**
 * Test whether a TCP port is free to bind
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '0.0.0.0');
  });
}

/**
 * Query project info from a running instance on a given port
 */
function getProjectInfoFromPort(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/project/info`, { timeout: 800 }, (res) => {
      if (res.statusCode !== 200) return resolve(null);
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.success && json.path) {
            resolve({ path: path.resolve(json.path), name: json.name });
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Find or allocate a port for a target project directory:
 * - If port 3000 (or preferredPort) is already watching the SAME project directory, reuse it.
 * - If port 3000 is occupied by a DIFFERENT project directory (or other service), hunt for next available (3001, 3002, etc.).
 * - If preferredPort is available, use it.
 */
async function findOrAllocatePort(targetProjectDir, preferredPort = 3000, maxPort = null) {
  const normalizedTarget = path.resolve(targetProjectDir);
  const pref = Number(preferredPort) || 3000;
  const max = maxPort ? Number(maxPort) : Math.max(pref + 100, 3100);

  // 1. Check registry if an active instance is already registered for this project
  const registry = readRegistry();
  const existing = registry[normalizedTarget];
  if (existing && existing.port && isProcessAlive(existing.pid)) {
    const portInfo = await getProjectInfoFromPort(existing.port);
    if (portInfo && portInfo.path === normalizedTarget) {
      return {
        port: existing.port,
        action: 'reuse',
        pid: existing.pid,
        projectPath: normalizedTarget,
      };
    }
  }

  // 2. Check preferredPort (e.g. 3000)
  const prefAvailable = await isPortAvailable(pref);
  if (!prefAvailable) {
    // Check if the occupying process is Virtual Office watching the SAME project directory
    const prefInfo = await getProjectInfoFromPort(pref);
    if (prefInfo && prefInfo.path === normalizedTarget) {
      registerInstance(normalizedTarget, pref);
      return {
        port: pref,
        action: 'reuse',
        projectPath: normalizedTarget,
      };
    }

    // Occupied by a DIFFERENT project directory or another application.
    // Port hunt for the next free port starting from pref + 1
    for (let p = pref + 1; p <= max; p++) {
      // Also check if port p is already watching this target project
      const pInfo = await getProjectInfoFromPort(p);
      if (pInfo && pInfo.path === normalizedTarget) {
        registerInstance(normalizedTarget, p);
        return {
          port: p,
          action: 'reuse',
          projectPath: normalizedTarget,
        };
      }

      const pAvail = await isPortAvailable(p);
      if (pAvail) {
        return {
          port: p,
          action: 'bind_new',
          projectPath: normalizedTarget,
          occupiedPreferred: pref,
        };
      }
    }

    throw new Error(`Unable to find an available port between ${pref} and ${max}`);
  }

  // Preferred port is completely available
  return {
    port: pref,
    action: 'bind_new',
    projectPath: normalizedTarget,
  };
}

/**
 * Cross-platform browser launcher
 */
function openInBrowser(targetUrl, preferredBrowser = 'Safari') {
  console.log(`🌐 Launching dashboard at ${targetUrl}...`);
  const platform = os.platform();

  try {
    if (platform === 'darwin') {
      try {
        child_process.execSync(`open -a "${preferredBrowser}" "${targetUrl}"`, { stdio: 'ignore' });
        console.log(`✅ ${preferredBrowser} opened successfully.`);
        return true;
      } catch (errPreferred) {
        child_process.execSync(`open "${targetUrl}"`, { stdio: 'ignore' });
        console.log('✅ Opened in default browser.');
        return true;
      }
    } else if (platform === 'win32') {
      child_process.execSync(`start "" "${targetUrl}"`, { stdio: 'ignore' });
      console.log('✅ Opened in Windows browser.');
      return true;
    } else {
      child_process.execSync(`xdg-open "${targetUrl}"`, { stdio: 'ignore' });
      console.log('✅ Opened in default Linux browser.');
      return true;
    }
  } catch (errDefault) {
    console.warn(`⚠️ Could not automatically launch browser. Please navigate to: ${targetUrl}`);
    return false;
  }
}

module.exports = {
  getRegistryPath,
  readRegistry,
  writeRegistry,
  registerInstance,
  unregisterInstance,
  updateInstancePath,
  getInstanceForProject,
  getAllInstances,
  isPortAvailable,
  getProjectInfoFromPort,
  findOrAllocatePort,
  openInBrowser,
  isProcessAlive,
};
