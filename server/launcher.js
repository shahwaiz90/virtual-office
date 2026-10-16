#!/usr/bin/env node

/**
 * AI Agent Virtual Office — Real-Time OpenCode Workflow Launcher
 * Mandatory workflow startup sequence:
 * 1. Parse target project directory and port options
 * 2. Start visualization backend if not running
 * 3. Serve production frontend on http://localhost:<port>
 * 4. Automatically open browser (Chrome / default)
 * 5. Load all configured agents & skills dynamically
 * 6. Confirm browser is ready & receiving events
 */

const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { getProjectRoot, findAgentsConfigFile } = require('./agentDiscovery');
const { findOrAllocatePort, openInBrowser, isPortAvailable } = require('./instanceRegistry');

// Parse CLI Flags
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    projectDir: getProjectRoot(),
    configFile: process.env.AGENTS_CONFIG || null,
    port: parseInt(process.env.PORT || '3000', 10),
    openBrowser: true,
    forceBuild: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dir' || arg === '-d' || arg === '--project') {
      if (args[i + 1]) options.projectDir = path.resolve(args[++i]);
    } else if (arg.startsWith('--dir=')) {
      options.projectDir = path.resolve(arg.split('=')[1]);
    } else if (arg.startsWith('--project=')) {
      options.projectDir = path.resolve(arg.split('=')[1]);
    } else if (arg === '--config' || arg === '-c') {
      if (args[i + 1]) options.configFile = path.resolve(args[++i]);
    } else if (arg.startsWith('--config=')) {
      options.configFile = path.resolve(arg.split('=')[1]);
    } else if (arg === '--port' || arg === '-p') {
      if (args[i + 1]) options.port = parseInt(args[++i], 10);
    } else if (arg.startsWith('--port=')) {
      options.port = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--no-open' || arg === '--headless') {
      options.openBrowser = false;
    } else if (arg === '--build') {
      options.forceBuild = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--version' || arg === '-v') {
      options.version = true;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
🏢 AI Agent Virtual Office — CLI

Usage:
  npx agent-virtual-office [options]
  agent-office [options]

Options:
  -d, --dir <path>       Target project directory (iOS, Android, Web, Backend)
                         (default: current working directory)
  -c, --config <file>    Path to specific agents.json file
                         (default: auto-scans all root & subfolders, merging multi-project configs)
  -p, --port <number>    Port to run the dashboard on (default: 3000)
  --no-open              Do not automatically open the browser
  --build                Rebuild the web frontend before starting
  -v, --version          Show version number
  -h, --help             Show this help guide

Examples:
  npx agent-virtual-office
  npx agent-virtual-office --dir /path/to/my-ios-app
  npx agent-virtual-office --config opencode/agents.json
  npx agent-virtual-office -d ./my-web-project --port 4000
  PROJECT_DIR=../android-app npx agent-virtual-office
`);
}

function isServerRunning(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Newest modification time of the UI sources, or 0 when they aren't shipped (installed package). */
function newestSourceMtime(dir) {
  let newest = 0;
  const walk = (p) => {
    let stat;
    try {
      stat = fs.statSync(p);
    } catch (e) {
      return;
    }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(p)) walk(path.join(p, name));
    } else {
      newest = Math.max(newest, stat.mtimeMs);
    }
  };
  for (const rel of ['src', 'index.html', 'vite.config.ts']) walk(path.join(dir, rel));
  return newest;
}

function ensureFrontendBuilt(forceBuild = false) {
  const root = path.resolve(__dirname, '..');
  const distHtml = path.join(root, 'dist', 'index.html');
  // dist/ is not committed: build when it is missing or older than the UI sources
  const stale = fs.existsSync(distHtml) && newestSourceMtime(root) > fs.statSync(distHtml).mtimeMs;
  if (forceBuild || stale || !fs.existsSync(distHtml)) {
    console.log('⚡ Building virtual office frontend assets...');
    try {
      execSync('npx vite build', {
        cwd: root,
        stdio: 'inherit',
      });
      console.log('✅ Frontend assets built successfully.');
    } catch (e) {
      console.error('❌ Error building frontend:', e.message);
    }
  }
}

async function verifyBrowserReadiness(port, projectDir) {
  console.log('🔍 Discovering agent configurations and server readiness...');
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/agents?dir=${encodeURIComponent(projectDir)}`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          console.log(`✅ Discovered ${json.count} agents for project: ${projectDir}`);
          json.agents.forEach((a) => {
            console.log(`   • [${a.badgeText}] ${a.name} (${a.role}) - ${a.skills.length} skills`);
          });
          resolve(true);
        } catch (e) {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
  });
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.version) {
    const pkg = require('../package.json');
    console.log(`v${pkg.version}`);
    process.exit(0);
  }

  const { port: requestedPort, projectDir, openBrowser, forceBuild } = options;

  ensureFrontendBuilt(forceBuild);

  // Automatic Port Discovery & Allocation:
  // - If port 3000 is already watching the SAME project directory, reuse it and open the browser tab.
  // - If occupied by an instance watching a DIFFERENT project directory, find next available port (3001, 3002...) and bind.
  const portResult = await findOrAllocatePort(projectDir, requestedPort);
  const port = portResult.port;
  const url = `http://localhost:${port}`;

  if (portResult.action === 'reuse') {
    console.log(`\n=======================================================`);
    console.log(`🏢 AI AGENT VIRTUAL OFFICE VISUALIZER`);
    console.log(`📁 Project Target : ${projectDir}`);
    console.log(`🔌 Port (Reused)  : ${port}`);
    console.log(`⚡ Existing instance already watching this project!`);
    console.log(`=======================================================\n`);

    if (openBrowser) {
      openInBrowser(url);
    }

    await verifyBrowserReadiness(port, projectDir);

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ REUSED EXISTING VIRTUAL OFFICE INSTANCE`);
    console.log(`📍 Dashboard : ${url}`);
    console.log(`📡 WebSocket : ws://localhost:${port}/ws`);
    console.log(`📁 Project   : ${projectDir}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    process.exit(0);
  }

  if (portResult.occupiedPreferred) {
    console.log(`⚡ Port ${portResult.occupiedPreferred} in use by another instance/app. Automatically allocated port ${port} for: ${projectDir}`);
  }

  // Export target project directory to environment
  process.env.PROJECT_DIR = projectDir;
  process.env.PORT = String(port);
  if (options.configFile) {
    process.env.AGENTS_CONFIG = options.configFile;
  }

  console.log(`\n=======================================================`);
  console.log(`🏢 AI AGENT VIRTUAL OFFICE VISUALIZER`);
  console.log(`📁 Project Target : ${projectDir}`);
  if (options.configFile) {
    console.log(`🎯 Config File    : ${options.configFile}`);
  }
  console.log(`🔌 Port           : ${port}`);
  console.log(`=======================================================\n`);

  const alreadyRunning = await isServerRunning(port);
  if (!alreadyRunning) {
    console.log(`🚀 Starting visualizer backend on port ${port}...`);
    const serverPath = path.resolve(__dirname, 'index.js');
    const child = spawn(process.execPath, [serverPath], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        PROJECT_DIR: projectDir,
        PORT: String(port),
      },
    });
    child.unref();

    // Wait for server to come up
    let attempts = 0;
    while (attempts < 25) {
      await new Promise((r) => setTimeout(r, 250));
      if (await isServerRunning(port)) break;
      attempts++;
    }
  } else {
    console.log(`⚡ Backend server already active on port ${port}.`);
  }

  // Open Browser
  if (openBrowser) {
    openInBrowser(url);
  }

  // Verify agents
  await verifyBrowserReadiness(port, projectDir);

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ VIRTUAL OFFICE IS LIVE`);
  console.log(`📍 Dashboard : ${url}`);
  console.log(`📡 WebSocket : ws://localhost:${port}/ws`);
  console.log(`📁 Project   : ${projectDir}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal launcher error:', err);
    process.exit(1);
  });
}

module.exports = { main, isServerRunning, openInBrowser, parseArgs };
