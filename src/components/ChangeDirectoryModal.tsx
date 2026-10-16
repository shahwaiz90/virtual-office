import React, { useState, useEffect } from 'react';
import { FolderOpen, X, Check, AlertCircle, Loader2, ExternalLink } from 'lucide-react';

interface ChangeDirectoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPath: string;
  onPathChanged?: (newPath: string, name: string) => void;
  serverPlatform?: string;
}

export const ChangeDirectoryModal: React.FC<ChangeDirectoryModalProps> = ({
  isOpen,
  onClose,
  currentPath,
  serverPlatform,
}) => {
  const [newPath, setNewPath] = useState(currentPath);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [successUrl, setSuccessUrl] = useState<string | null>(null);
  const [isPickingInFinder, setIsPickingInFinder] = useState(false);

  // Dynamically adapt labels for Windows Explorer vs macOS Finder vs Linux File Manager
  const isWindows =
    serverPlatform === 'win32' ||
    (typeof navigator !== 'undefined' &&
      /win/i.test((navigator as any).userAgentData?.platform || navigator.platform || navigator.userAgent));
  const isMac =
    serverPlatform === 'darwin' ||
    (typeof navigator !== 'undefined' &&
      /mac/i.test((navigator as any).userAgentData?.platform || navigator.platform || navigator.userAgent));

  const osTitle = isWindows ? 'Windows Explorer' : isMac ? 'macOS Finder' : 'System File Manager';
  const osAction = isWindows ? 'File Explorer' : isMac ? 'Finder' : 'File Manager';

  useEffect(() => {
    if (isOpen) {
      setNewPath(currentPath);
      setError(null);
      setSuccessMsg(null);
      setSuccessUrl(null);
      setIsPickingInFinder(false);
    }
  }, [isOpen, currentPath]);

  if (!isOpen) return null;

  /**
   * Always launches the selected project in a new window/tab on its own isolated port
   */
  const executeLaunchInNewWindow = async (targetPath: string) => {
    if (!targetPath || !targetPath.trim()) {
      setError('Please enter a valid directory path.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    setSuccessUrl(null);

    try {
      const resp = await fetch('/api/project/spawn-instance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath.trim() }),
      });

      const rawText = await resp.text();
      let data: any = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        if (resp.status === 404) {
          throw new Error('Endpoint /api/project/spawn-instance was not found (404). Please restart the visualizer server to apply the updated multi-project routes.');
        }
        throw new Error(`Server returned unexpected response (${resp.status}): ${rawText.slice(0, 150)}`);
      }

      if (!resp.ok || !data.success) {
        setError(data.error || 'Failed to spawn new server instance.');
        setIsSubmitting(false);
        return;
      }

      const targetUrl = data.url || `http://localhost:${data.port}`;
      setSuccessUrl(targetUrl);

      // On macOS, the server natively launches Safari via `open -a "Safari"`.
      // If client is already running in Safari, window.open is seamless.
      // In other browsers (e.g. Chrome), avoid window.open to prevent duplicate tabs across multiple browsers.
      try {
        const isSafari =
          typeof navigator !== 'undefined' &&
          /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        if (typeof window !== 'undefined' && isSafari) {
          window.open(targetUrl, '_blank');
        }
      } catch (openErr: any) {
        console.warn('Browser launch notice:', openErr);
      }

      setSuccessMsg(
        data.action === 'reused'
          ? `Reused existing instance on port ${data.port}. Opened in Safari!`
          : `Spawned new instance on port ${data.port} for ${data.name || 'project'}. Opened in Safari!`
      );

      setTimeout(() => {
        setIsSubmitting(false);
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err?.message || 'Connection error while communicating with server.');
      setIsSubmitting(false);
    }
  };

  /**
   * System native folder picker (Finder / Explorer) -> Always opens in new window/port
   */
  const handleBrowseFinder = async () => {
    setIsPickingInFinder(true);
    setError(null);
    setSuccessMsg(null);
    setSuccessUrl(null);

    try {
      const resp = await fetch('/api/project/pick-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply: false }), // Do NOT switch current server workspace
      });

      const rawText = await resp.text();
      let data: any = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error(rawText.slice(0, 150) || 'Could not parse response from system folder picker.');
      }

      if (data.canceled) {
        setIsPickingInFinder(false);
        return;
      }

      if (!resp.ok || !data.success || !data.path) {
        setError(data.error || `Could not select folder in ${osTitle}.`);
        setIsPickingInFinder(false);
        return;
      }

      setNewPath(data.path);
      setIsPickingInFinder(false);

      // Immediately launch the picked folder in a new window/port
      await executeLaunchInNewWindow(data.path);
    } catch (err: any) {
      setError(err?.message || `Error opening ${osTitle}.`);
      setIsPickingInFinder(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await executeLaunchInNewWindow(newPath);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-scrim/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-surface rounded-3xl border border-sand-200/90 shadow-2xl max-w-md w-full overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-sand-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-brand-50 border border-brand-200 flex items-center justify-center text-brand-600">
              <FolderOpen className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-sand-900">Open Project in New Window</h2>
              <p className="text-[11px] text-sand-400">Launch any codebase in a new Safari window</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl hover:bg-sand-100 flex items-center justify-center text-sand-400 hover:text-sand-600 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-bold text-sand-700">
              Project Directory
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={newPath}
                onChange={(e) => {
                  setNewPath(e.target.value);
                  setError(null);
                }}
                placeholder="/path/to/your/project"
                className="flex-1 bg-sand-50 border border-sand-200 rounded-xl px-3.5 py-2 text-xs font-mono text-sand-900 placeholder:text-sand-400 focus:outline-none focus:border-brand-500 focus:bg-surface transition-all"
                disabled={isSubmitting || isPickingInFinder}
                autoFocus
              />
              <button
                type="button"
                onClick={handleBrowseFinder}
                disabled={isPickingInFinder || isSubmitting}
                className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-sand-700 bg-sand-100 hover:bg-sand-200 active:scale-95 transition-all cursor-pointer shrink-0 disabled:opacity-60 border border-sand-200"
              >
                {isPickingInFinder ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-sand-600" />
                    <span>Opening...</span>
                  </>
                ) : (
                  <>
                    <FolderOpen className="w-3.5 h-3.5 text-sand-600" />
                    <span>Browse in {osAction}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 flex items-start gap-2 text-xs animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <div className="leading-relaxed">{error}</div>
            </div>
          )}

          {/* Success Message */}
          {successMsg && (
            <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 space-y-1 text-xs animate-in fade-in font-medium">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0 text-emerald-600" />
                <div>{successMsg}</div>
              </div>
              {successUrl && (
                <div className="pl-6 text-[11px]">
                  <a
                    href={successUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-600 hover:text-brand-800 underline font-semibold flex items-center gap-1"
                  >
                    <span>Click here to open manually</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="px-6 py-4 bg-sand-50 border-t border-sand-100 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold text-sand-600 hover:text-sand-800 hover:bg-sand-100 transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={isSubmitting || !newPath.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white shadow-xs active:scale-95 transition-all cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Opening in Safari...</span>
              </>
            ) : (
              <>
                <span>Open in Safari</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};
