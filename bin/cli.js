#!/usr/bin/env node

/**
  * agent-virtual-office CLI Entrypoint
  *
  * Execute directly via npx or global npm:
  *   npx agent-virtual-office
  *   npx agent-virtual-office --dir /path/to/my-ios-app
  *   npx agent-virtual-office --dir /path/to/my-web-app --port 3030
  */

const { main } = require('../server/launcher');

main().catch((err) => {
  console.error('[agent-virtual-office] Fatal CLI error:', err);
  process.exit(1);
});
