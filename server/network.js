/**
 * The portal is a local tool: it listens on the loopback interface and only answers browsers
 * on a local origin. Set VIRTUAL_OFFICE_HOST (e.g. 0.0.0.0) to expose it deliberately.
 */
const LISTEN_HOST = process.env.VIRTUAL_OFFICE_HOST || '127.0.0.1';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function hostnameOf(value) {
  if (!value) return null;
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname.toLowerCase();
  } catch (e) {
    return null;
  }
}

/** A browser Origin header from this machine (any port: dev server, other instances). */
function isLocalOrigin(origin) {
  if (!origin || origin === 'null') return false;
  const host = hostnameOf(origin);
  return Boolean(host && (LOCAL_HOSTNAMES.has(host) || host.endsWith('.localhost')));
}

/** The Host header names this machine (guards against DNS rebinding). */
function isLocalHostHeader(hostHeader) {
  const host = hostnameOf(hostHeader);
  return Boolean(host && (LOCAL_HOSTNAMES.has(host) || host.endsWith('.localhost')));
}

/**
 * Express middleware: requests without an Origin (curl from agents, server-to-server) pass;
 * browser requests from another site are refused, as are requests addressed to a non-local host.
 * Exposing the server on purpose (VIRTUAL_OFFICE_HOST) turns the host check off.
 */
function localOnly(req, res, next) {
  const exposed = LISTEN_HOST !== '127.0.0.1' && LISTEN_HOST !== 'localhost' && LISTEN_HOST !== '::1';
  if (!exposed && req.headers.host && !isLocalHostHeader(req.headers.host)) {
    return res.status(403).json({ success: false, error: 'Virtual Office only answers requests addressed to localhost.' });
  }
  const origin = req.headers.origin;
  if (origin && !isLocalOrigin(origin)) {
    return res.status(403).json({ success: false, error: `Requests from ${origin} are not allowed.` });
  }
  next();
}

/** cors() options: reflect only local origins. */
const corsOptions = {
  origin: (origin, callback) => callback(null, !origin || isLocalOrigin(origin)),
};

// The address this server answers on; agents read it from .agents/portal-url in the project
let portalPort = parseInt(process.env.PORT || '3000', 10);
const PORTAL_URL_FILE = '.agents/portal-url';

function setPortalPort(port) {
  portalPort = Number(port) || portalPort;
}

function portalUrl() {
  return `http://localhost:${portalPort}`;
}

/** Writes the portal address into the project (gitignored: it is per machine) so agents call the right instance. */
function writePortalUrl(projectRoot) {
  const fs = require('fs');
  const path = require('path');
  if (!projectRoot) return;
  try {
    const file = path.join(projectRoot, PORTAL_URL_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8').trim() !== portalUrl()) fs.writeFileSync(file, `${portalUrl()}\n`, 'utf8');
    const gitignore = path.join(projectRoot, '.gitignore');
    const text = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, 'utf8') : '';
    if (fs.existsSync(path.join(projectRoot, '.git')) && !text.split('\n').some((l) => l.trim() === PORTAL_URL_FILE)) {
      fs.writeFileSync(gitignore, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${PORTAL_URL_FILE}\n`, 'utf8');
    }
  } catch (e) {
    console.warn(`[Network] Could not write ${PORTAL_URL_FILE}: ${e.message}`);
  }
}

module.exports = { LISTEN_HOST, isLocalOrigin, isLocalHostHeader, localOnly, corsOptions, setPortalPort, portalUrl, writePortalUrl, PORTAL_URL_FILE };
