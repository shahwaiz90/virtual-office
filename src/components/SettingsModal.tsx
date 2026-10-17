import React from 'react';
import { X, Check, Folder, FolderOpen, Settings, KeyRound } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectPath?: string;
  onOpenChangeDirectory?: () => void;
  onOpenIntegrations?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  projectPath,
  onOpenChangeDirectory,
  onOpenIntegrations,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-scrim/40 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Settings Dialog Card */}
      <div className="bg-surface rounded-3xl border border-sand-200/90 shadow-2xl max-w-lg w-full overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="px-6 py-4 border-b border-sand-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-brand-50 border border-brand-200 flex items-center justify-center text-brand-600">
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-sand-900">Agent Virtual Office Preferences</h2>
              <p className="text-[11px] text-sand-400">Project folder and integrations</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-sand-400 hover:text-sand-700 hover:bg-sand-100 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Settings Body */}
        <div className="p-6 space-y-4 text-xs text-sand-700">

          {/* Target Project Workspace Directory */}
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200/80">
            <div className="space-y-0.5 max-w-[310px] min-w-0">
              <div className="font-bold text-sand-800 flex items-center gap-1.5">
                <Folder className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Monitored Project Directory</span>
              </div>
              <p className="text-[11px] font-mono text-sand-600 truncate" title={projectPath || 'Current Workspace'}>
                {projectPath || 'Current Workspace'}
              </p>
            </div>

            {onOpenChangeDirectory && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenChangeDirectory();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-amber-800 bg-surface hover:bg-amber-100 border border-amber-300 transition-colors shadow-2xs active:scale-95 cursor-pointer shrink-0 ml-2"
              >
                <FolderOpen className="w-3.5 h-3.5 text-amber-600" />
                <span>Change...</span>
              </button>
            )}
          </div>

          {/* Jira / Confluence access */}
          {onOpenIntegrations && (
            <div className="flex items-center justify-between p-3.5 rounded-2xl bg-sand-50 border border-sand-200/80">
              <div className="space-y-0.5 max-w-[310px] min-w-0">
                <div className="font-bold text-sand-800 flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4 text-brand-600 shrink-0" />
                  <span>Integrations</span>
                </div>
                <p className="text-[11px] text-sand-500">Jira and Confluence server URLs, tokens and connection test</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenIntegrations();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-brand-700 bg-surface hover:bg-brand-50 border border-brand-200 transition-colors shadow-2xs active:scale-95 cursor-pointer shrink-0 ml-2"
              >
                <span>Open...</span>
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-sand-50 border-t border-sand-100 flex items-center justify-end">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-brand-600 hover:bg-brand-700 text-white shadow-xs active:scale-95 transition-all cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Done</span>
          </button>
        </div>

      </div>
    </div>
  );
};
