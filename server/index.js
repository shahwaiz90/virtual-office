const http = require('http');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const { eventBus } = require('./eventBus');
const { discoverAgents } = require('./agentDiscovery');
const { setupWatchers } = require('./watchers');
const { demoSimulator } = require('./demoSimulator');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

app.use(cors());
app.use(express.json());

// 1. API: Discovered Agents
app.get('/api/agents', (req, res) => {
  const customDir = req.query.dir || process.env.PROJECT_DIR;
  const customConfig = req.query.config || process.env.AGENTS_CONFIG;
  const agents = discoverAgents(customDir, customConfig);
  res.json({ success: true, count: agents.length, agents });
});

// 2. API: Current Office State Snapshot
app.get('/api/state', (req, res) => {
  res.json({ success: true, state: eventBus.getStateSnapshot() });
});

// 3. API: Chronological Event Logs
app.get('/api/events', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const agent = req.query.agent;
  let filtered = eventBus.events;
  if (agent) {
    filtered = filtered.filter((e) => e.agentId === agent);
  }
  res.json({
    success: true,
    count: filtered.length,
    events: filtered.slice(0, limit),
  });
});

// 4. API: Ingest External Event (CLI / Hooks / OpenCode)
app.post('/api/events', (req, res) => {
  const rawEvent = req.body;
  if (!rawEvent) {
    return res.status(400).json({ error: 'Missing event body' });
  }
  const normalized = eventBus.emitEvent(rawEvent);
  res.json({ success: true, event: normalized });
});

// 5. API: Demo Mode Control
app.post('/api/demo/start', (req, res) => {
  demoSimulator.start();
  res.json({ success: true, message: 'Demo simulation started' });
});

app.post('/api/demo/stop', (req, res) => {
  demoSimulator.stop();
  res.json({ success: true, message: 'Demo simulation stopped' });
});

// Clear Office State & Reset to Standby
app.post('/api/state/clear', (req, res) => {
  demoSimulator.stop();
  eventBus.clearState();
  res.json({ success: true, message: 'Office state, tasks, and analytics cleared' });
});

// 6. API: Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptimeSeconds: Math.floor(process.uptime()),
    connectedClients: eventBus.wsClients.size,
    totalEvents: eventBus.events.length,
  });
});

// 7. Serve Built Frontend and Avatars in Production
const DIST_PATH = path.join(__dirname, '../dist');
const PUBLIC_ASSETS = path.join(__dirname, '../public/assets');
const DIST_ASSETS = path.join(DIST_PATH, 'assets');

if (fs.existsSync(PUBLIC_ASSETS)) {
  app.use('/assets', express.static(PUBLIC_ASSETS));
}
if (fs.existsSync(DIST_ASSETS)) {
  app.use('/assets', express.static(DIST_ASSETS));
}
app.use(express.static(DIST_PATH));

// SPA fallback for Express 5
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
    return next();
  }
  const indexPath = path.join(DIST_PATH, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.send(`
        <html>
          <head><title>AI Agent Virtual Office Backend</title></head>
          <body style="background:#0f172a;color:#f8fafc;font-family:sans-serif;padding:40px;text-align:center;">
            <h2>🏢 AI Agent Virtual Office Server is Running!</h2>
            <p>Port: 3000 | WebSocket: /ws</p>
            <p>Start frontend via: <code>npm run dev</code> or visit <a href="http://localhost:5173" style="color:#6366f1;">http://localhost:5173</a></p>
          </body>
        </html>
      `);
    }
  });
});

// WebSocket Connection Handler
wss.on('connection', (ws, req) => {
  console.log(`[WebSocket] Browser client connected from ${req.socket.remoteAddress}`);
  eventBus.registerWsClient(ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
      } else if (data.type === 'TRIGGER_DEMO') {
        demoSimulator.start();
      } else if (data.type === 'STOP_DEMO') {
        demoSimulator.stop();
      } else if (data.type === 'CLEAR_STATE') {
        demoSimulator.stop();
        eventBus.clearState();
      }
    } catch (e) {
      // non-json message
    }
  });
});

const PORT = process.env.PORT || 3000;

function startServer() {
  server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🏢 AI AGENT VIRTUAL OFFICE BACKEND RUNNING`);
    console.log(`📡 URL: http://localhost:${PORT}`);
    console.log(`🔌 WebSocket: ws://localhost:${PORT}/ws`);
    console.log(`=======================================================`);

    // Start watching real-time transcripts and scratch tasks
    setupWatchers();
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  server,
  startServer,
};
