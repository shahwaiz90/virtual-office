import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, X, Check, Copy, ExternalLink, Loader2, RefreshCw, AlertCircle, PlugZap } from 'lucide-react';

interface IntegrationStatus {
  name: string;
  configured: boolean;
  tokenSet: boolean;
  tokenHint: string | null;
  source: string | null;
  envVar: string;
  baseVar: string;
  usedBy: string[];
  server: string | null;
  tokenPage: string | null;
  steps: { baseLine: string; envLine: string; copyEnv: string; shell: string; oneRun: string };
}

interface TestResult {
  ok: boolean;
  reason: string;
  message: string;
}

interface IntegrationsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Jira / Confluence setup: status, the steps to add a token, and a connection test. Never shows token values. */
export const IntegrationsPanel: React.FC<IntegrationsPanelProps> = ({ isOpen, onClose }) => {
  const [integrations, setIntegrations] = useState<Record<string, IntegrationStatus> | null>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [copied, setCopied] = useState<string | null>(null);
  // What the user is typing per integration; the token field always starts empty
  const [drafts, setDrafts] = useState<Record<string, { baseUrl: string; token: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<Record<string, { ok: boolean; text: string }>>({});

  const refresh = useCallback(() => {
    setLoading(true);
    fetch('/api/integrations')
      .then((r) => r.json())
      .then((json) => setIntegrations(json.integrations || null))
      .catch(() => setIntegrations(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (isOpen) {
      setResults({});
      refresh();
    }
  }, [isOpen, refresh]);

  if (!isOpen) return null;

  const copy = (key: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const draftOf = (id: string, it: IntegrationStatus) => drafts[id] || { baseUrl: it.server || '', token: '' };

  const save = async (id: string, body: Record<string, unknown>) => {
    setSaving(id);
    try {
      const json = await fetch(`/api/integrations/${id}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json());
      if (json.success) {
        setIntegrations((prev) => (prev ? { ...prev, [id]: json.integration } : prev));
        setDrafts((prev) => ({ ...prev, [id]: { baseUrl: json.integration.server || '', token: '' } }));
        setResults((prev) => ({ ...prev, [id]: undefined as unknown as TestResult }));
        setSaveMsg((prev) => ({ ...prev, [id]: { ok: true, text: body.clear ? 'Removed from .env.local.' : 'Saved to .env.local.' } }));
      } else {
        setSaveMsg((prev) => ({ ...prev, [id]: { ok: false, text: json.error || 'Could not save.' } }));
      }
    } catch (e) {
      setSaveMsg((prev) => ({ ...prev, [id]: { ok: false, text: 'The portal server did not answer.' } }));
    } finally {
      setSaving(null);
    }
  };

  const test = async (id: string) => {
    setTesting(id);
    try {
      const json = await fetch(`/api/integrations/${id}/test`, { method: 'POST' }).then((r) => r.json());
      setResults((prev) => ({ ...prev, [id]: json.result }));
    } catch (e) {
      setResults((prev) => ({ ...prev, [id]: { ok: false, reason: 'error', message: 'The portal server did not answer.' } }));
    } finally {
      setTesting(null);
    }
  };

  const CopyLine = ({ id, text }: { id: string; text: string }) => (
    <div className="flex items-center gap-2 bg-sand-50 border border-sand-200 rounded-lg px-2.5 py-1.5">
      <code className="flex-1 text-[11px] font-mono text-sand-800 break-all">{text}</code>
      <button
        type="button"
        onClick={() => copy(id, text)}
        className="p-1 rounded text-sand-400 hover:text-brand-600 hover:bg-brand-50 cursor-pointer shrink-0"
        title="Copy"
        aria-label={`Copy ${text}`}
      >
        {copied === id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-scrim/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface rounded-3xl border border-sand-200/90 shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="integrations-title"
      >
        <div className="px-6 py-4 border-b border-sand-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-brand-50 border border-brand-200 flex items-center justify-center text-brand-600">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h2 id="integrations-title" className="text-sm font-extrabold text-sand-900">Integrations</h2>
              <p className="text-[11px] text-sand-400">Jira and Confluence access for the read-jira and read-confluence skills</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={refresh}
              className="p-1.5 rounded-lg text-sand-400 hover:text-brand-600 hover:bg-brand-50 cursor-pointer"
              title="Check again"
              aria-label="Check again"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-sand-400 hover:text-sand-700 hover:bg-sand-100 cursor-pointer" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          {!integrations && !loading && (
            <p className="text-xs text-rose-700 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" /> Could not read the integration status from the server.
            </p>
          )}

          {integrations &&
            Object.entries(integrations).map(([id, it]) => {
              const result = results[id];
              return (
                <section key={id} className="border border-sand-200 rounded-2xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <h3 className="text-sm font-bold text-sand-900">{it.name}</h3>
                      <p className="text-[11px] text-sand-500">
                        Reads <code className="font-mono">{it.baseVar}</code> and <code className="font-mono">{it.envVar}</code>
                        {it.server ? <> · server <code className="font-mono">{it.server}</code></> : null}
                        {' · '}
                        {it.usedBy.length ? <>used by {it.usedBy.map((a) => <code key={a} className="font-mono">{a} </code>)}</> : 'no role on this team uses it'}
                      </p>
                    </div>
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                        it.configured ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}
                    >
                      {it.configured
                        ? `Ready (token ${it.tokenHint || ''} from ${it.source})`
                        : `Missing: ${[!it.server && it.baseVar, !it.tokenSet && it.envVar].filter(Boolean).join(', ')}`}
                    </span>
                  </div>

                  {/* Enter the settings here; they are saved to the project's .env.local */}
                  <form
                    className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const d = draftOf(id, it);
                      save(id, { baseUrl: d.baseUrl.trim(), token: d.token.trim() });
                    }}
                  >
                    <label className="text-[11px] font-semibold text-sand-600 space-y-1">
                      <span>Server URL</span>
                      <input
                        type="url"
                        value={draftOf(id, it).baseUrl}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [id]: { ...draftOf(id, it), baseUrl: e.target.value } }))}
                        placeholder={it.steps.baseLine.split('=')[1].replace(/"/g, '')}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-sand-200 bg-surface text-xs font-mono text-sand-800 focus:outline-hidden focus:border-brand-500"
                      />
                    </label>
                    <label className="text-[11px] font-semibold text-sand-600 space-y-1">
                      <span>Access token</span>
                      <input
                        type="password"
                        autoComplete="off"
                        value={draftOf(id, it).token}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [id]: { ...draftOf(id, it), token: e.target.value } }))}
                        placeholder={it.tokenSet ? `Saved (${it.tokenHint}); paste to replace` : 'Paste your personal access token'}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-sand-200 bg-surface text-xs font-mono text-sand-800 focus:outline-hidden focus:border-brand-500"
                      />
                    </label>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="submit"
                        disabled={saving === id}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 cursor-pointer"
                      >
                        {saving === id ? 'Saving…' : 'Save'}
                      </button>
                      {(it.server || it.tokenSet) && (
                        <button
                          type="button"
                          onClick={() => save(id, { clear: true })}
                          disabled={saving === id}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-sand-300 text-sand-600 hover:bg-sand-50 disabled:opacity-50 cursor-pointer"
                          title="Remove the server URL and token from .env.local"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </form>
                  {saveMsg[id] && (
                    <p className={`text-[11px] ${saveMsg[id].ok ? 'text-emerald-700' : 'text-rose-700'}`} role="status">
                      {saveMsg[id].text}
                    </p>
                  )}
                  {it.source && !String(it.source).startsWith('.env') && (
                    <p className="text-[11px] text-sand-500">
                      The token currently comes from {it.source}; a token saved here goes to <code className="font-mono">.env.local</code> and the scripts use whichever they find first (environment, then <code className="font-mono">.env.local</code>).
                    </p>
                  )}

                  {!it.configured && (
                    <details className="text-xs text-sand-700">
                      <summary className="cursor-pointer font-semibold text-sand-600">Where to get a token, or set it manually</summary>
                    <ol className="space-y-2.5 text-xs text-sand-700 list-decimal pl-4 mt-2">
                      <li className="space-y-1.5">
                        <span>Create a personal access token in {it.name}{it.tokenPage ? '.' : ' (avatar > profile/settings > Personal Access Tokens).'}</span>
                        {it.tokenPage && (
                          <a
                            href={it.tokenPage}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-2 inline-flex items-center gap-1 text-brand-700 font-semibold hover:underline"
                          >
                            Open token page <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </li>
                      <li className="space-y-1.5">
                        <span>In the project root, copy <code className="font-mono">.env.example</code> to <code className="font-mono">.env.local</code> (it is gitignored):</span>
                        <CopyLine id={`${id}-copy`} text={it.steps.copyEnv} />
                        <span className="block">Then set your server URL and token in <code className="font-mono">.env.local</code>:</span>
                        <CopyLine id={`${id}-base`} text={it.steps.baseLine} />
                        <CopyLine id={`${id}-env`} text={it.steps.envLine} />
                      </li>
                      <li className="space-y-1.5">
                        <span>Or set them in your shell (add them to <code className="font-mono">~/.zshrc</code> to keep them):</span>
                        <CopyLine id={`${id}-shell-base`} text={`export ${it.steps.baseLine}`} />
                        <CopyLine id={`${id}-shell`} text={it.steps.shell} />
                      </li>
                      <li>
                        Click <strong>Check again</strong> above, then <strong>Test connection</strong>.
                      </li>
                    </ol>
                    </details>
                  )}

                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => test(id)}
                      disabled={!it.configured || testing === id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 cursor-pointer"
                      title={it.configured ? `Sign in to ${it.name} once with the stored token` : `Set ${it.baseVar} and ${it.envVar} first`}
                    >
                      {testing === id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />}
                      Test connection
                    </button>
                    {result && (
                      <span className={`text-xs font-medium ${result.ok ? 'text-emerald-700' : 'text-rose-700'}`} role="status">
                        {result.message}
                      </span>
                    )}
                  </div>
                </section>
              );
            })}

          <p className="text-[11px] text-sand-400">
            The portal never stores or displays tokens. A connection test sends the token only to the server URL you configured.
          </p>
        </div>
      </div>
    </div>
  );
};
