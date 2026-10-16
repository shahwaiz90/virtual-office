import React, { useState, useMemo } from 'react';
import { RoleDeliverable, DeliverableType, DeliverableStatus } from '../types/office';
import {
  FileText,
  FileCode,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Layers,
  ArrowRight,
  ExternalLink,
  Copy,
  Check,
  X,
  Code2,
  Sparkles,
  GitPullRequest,
  CheckCheck,
  Search,
  Filter,
  Columns,
  ListOrdered,
  FileCheck2,
  AlertCircle
} from 'lucide-react';

interface RoleDeliverablesHubProps {
  deliverables?: RoleDeliverable[];
}

type RoleTab = 'all' | 'pm' | 'tech-lead' | 'dev' | 'qa';
type ViewMode = 'columns' | 'timeline';

interface ColumnDef {
  key: RoleTab;
  title: string;
  roleSubtitle: string;
  icon: any;
  color: string;
  lightBg: string;
  borderColor: string;
  badgeBg: string;
  badgeText: string;
  deliverableTypes: string;
}

const ROLE_COLUMNS: ColumnDef[] = [
  {
    key: 'pm',
    title: 'Product Management',
    roleSubtitle: 'PRDs, User Stories & Acceptance Criteria',
    icon: FileText,
    color: 'text-brand-700',
    lightBg: 'bg-brand-50/70',
    borderColor: 'border-brand-200/90',
    badgeBg: 'bg-brand-100 text-brand-800',
    badgeText: 'PM',
    deliverableTypes: 'PRD • DoD • Stories',
  },
  {
    key: 'tech-lead',
    title: 'Technical Leadership',
    roleSubtitle: 'Architecture Contracts & Review Gates',
    icon: Layers,
    color: 'text-purple-700',
    lightBg: 'bg-purple-50/70',
    borderColor: 'border-purple-200/90',
    badgeBg: 'bg-purple-100 text-purple-800',
    badgeText: 'LEAD',
    deliverableTypes: 'Architecture • Plan • Reviews',
  },
  {
    key: 'dev',
    title: 'Core Development',
    roleSubtitle: 'Production Modules, APIs & Components',
    icon: Code2,
    color: 'text-blue-700',
    lightBg: 'bg-blue-50/70',
    borderColor: 'border-blue-200/90',
    badgeBg: 'bg-blue-100 text-blue-800',
    badgeText: 'DEV',
    deliverableTypes: 'Source Code • Modules • DTOs',
  },
  {
    key: 'qa',
    title: 'QA & Verification',
    roleSubtitle: 'Test Suites, Regression & Coverage',
    icon: ShieldCheck,
    color: 'text-emerald-700',
    lightBg: 'bg-emerald-50/70',
    borderColor: 'border-emerald-200/90',
    badgeBg: 'bg-emerald-100 text-emerald-800',
    badgeText: 'QA',
    deliverableTypes: 'E2E Suites • Regression • Metrics',
  },
];

export const RoleDeliverablesHub: React.FC<RoleDeliverablesHubProps> = ({ deliverables = [] }) => {
  const [selectedRole, setSelectedRole] = useState<RoleTab>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('columns');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeModalItem, setActiveModalItem] = useState<RoleDeliverable | null>(null);
  const [modalTab, setModalTab] = useState<'preview' | 'raw' | 'metadata'>('preview');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyContent = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getStatusBadge = (status: DeliverableStatus) => {
    switch (status) {
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCheck className="w-2.5 h-2.5" />
            Approved
          </span>
        );
      case 'in_review':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
            <Clock className="w-2.5 h-2.5" />
            In Review
          </span>
        );
      case 'delivered':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-300">
            <CheckCircle2 className="w-2.5 h-2.5" />
            Delivered
          </span>
        );
    }
  };

  const getTypeLabel = (type: DeliverableType) => {
    switch (type) {
      case 'prd':
        return 'PRD Spec';
      case 'architecture':
        return 'Architecture Contract';
      case 'implementation_plan':
        return 'Implementation Plan';
      case 'source_code':
        return 'Source Code';
      case 'code_review':
        return 'Quality Gate Review';
      case 'test_report':
        return 'Test Suite Report';
      case 'release_signoff':
        return 'Release Sign-Off';
      default:
        return 'Artifact';
    }
  };

  const filteredItems = useMemo(() => {
    return deliverables.filter((item) => {
      const matchesRole =
        selectedRole === 'all' ||
        (item.roleSlug && item.roleSlug === selectedRole) ||
        (item.role && item.role.toLowerCase().includes(selectedRole.replace('-', ' ')));

      const matchesSearch =
        !searchQuery.trim() ||
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.agentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.filePath && item.filePath.toLowerCase().includes(searchQuery.toLowerCase()));

      return matchesRole && matchesSearch;
    });
  }, [deliverables, selectedRole, searchQuery]);

  return (
    <section id="deliverables-hub" className="bg-surface rounded-2xl border border-sand-200/90 shadow-xs p-4 sm:p-6 transition-all">
      {/* Header bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-sand-200/80 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
              📦
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-extrabold text-sand-900 tracking-tight">
                  Role Deliverables & Artifacts Hub
                </h2>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-brand-50 text-brand-700 border border-brand-200">
                  {deliverables.length} Deliverable{deliverables.length === 1 ? '' : 's'}
                </span>
              </div>
              <p className="text-xs text-sand-500 mt-0.5">
                Authoritative register of PRDs, architecture specifications, source code, and QA test reports generated across agent roles.
              </p>
            </div>
          </div>
        </div>

        {/* View Mode & Filter Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Search box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-sand-400" />
            <input
              type="text"
              placeholder="Search deliverables..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 rounded-xl border border-sand-200 text-xs w-40 sm:w-56 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 bg-sand-50/60"
            />
          </div>

          {/* View Mode Switcher */}
          <div className="inline-flex p-0.5 rounded-xl bg-sand-100 border border-sand-200">
            <button
              onClick={() => setViewMode('columns')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                viewMode === 'columns'
                  ? 'bg-surface text-brand-700 shadow-2xs'
                  : 'text-sand-600 hover:text-sand-900'
              }`}
              title="Organized by Role Columns"
            >
              <Columns className="w-3.5 h-3.5" />
              <span>Role Columns</span>
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                viewMode === 'timeline'
                  ? 'bg-surface text-brand-700 shadow-2xs'
                  : 'text-sand-600 hover:text-sand-900'
              }`}
              title="Sequential Delivery Pipeline"
            >
              <ListOrdered className="w-3.5 h-3.5" />
              <span>Timeline Flow</span>
            </button>
          </div>
        </div>
      </div>

      {/* Role filter chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto py-3 no-scrollbar border-b border-sand-100">
        <button
          onClick={() => setSelectedRole('all')}
          className={`px-3 py-1 rounded-full text-xs font-semibold transition-all shrink-0 cursor-pointer ${
            selectedRole === 'all'
              ? 'bg-sand-900 text-white shadow-2xs theme-static'
              : 'bg-sand-100 text-sand-600 hover:bg-sand-200'
          }`}
        >
          All Roles ({deliverables.length})
        </button>
        {ROLE_COLUMNS.map((col) => {
          const count = deliverables.filter(
            (d) => d.roleSlug === col.key || (d.role && d.role.toLowerCase().includes(col.key.replace('-', ' ')))
          ).length;
          const isSelected = selectedRole === col.key;
          return (
            <button
              key={col.key}
              onClick={() => setSelectedRole(col.key)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                isSelected
                  ? 'bg-brand-600 text-white shadow-2xs'
                  : 'bg-sand-100 text-sand-600 hover:bg-sand-200'
              }`}
            >
              <span>{col.title}</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                  isSelected ? 'bg-brand-800 text-white' : 'bg-surface text-sand-600'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Main Content Area */}
      <div className="mt-4">
        {deliverables.length === 0 ? (
          <div className="text-center py-12 px-4 border border-dashed border-sand-200 rounded-xl bg-sand-50/50">
            <FileText className="w-10 h-10 text-sand-300 mx-auto mb-2" />
            <h3 className="text-sm font-bold text-sand-700">No deliverables generated yet</h3>
            <p className="text-xs text-sand-500 max-w-md mx-auto mt-1">
              Deliverables appear here automatically as agents draft PRDs, design architecture contracts, commit code, and publish test reports.
            </p>
          </div>
        ) : viewMode === 'columns' ? (
          /* Role Columns Grid */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {ROLE_COLUMNS.map((col) => {
              const colItems = filteredItems.filter(
                (item) =>
                  item.roleSlug === col.key ||
                  (item.role && item.role.toLowerCase().includes(col.key.replace('-', ' ')))
              );
              const Icon = col.icon;

              return (
                <div
                  key={col.key}
                  className={`flex flex-col rounded-xl border ${col.borderColor} ${col.lightBg} p-3 transition-all min-h-[380px]`}
                >
                  {/* Column Header */}
                  <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-sand-200/70 mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`p-1.5 rounded-lg bg-surface shadow-2xs ${col.color}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-xs font-bold text-sand-900 truncate">{col.title}</h3>
                          <span className={`text-[10px] font-extrabold px-1.5 py-0.2 rounded-full ${col.badgeBg}`}>
                            {colItems.length}
                          </span>
                        </div>
                        <p className="text-[10px] text-sand-500 truncate">{col.deliverableTypes}</p>
                      </div>
                    </div>
                  </div>

                  {/* Cards inside column */}
                  <div className="space-y-3 flex-1 overflow-y-auto max-h-[620px] pr-1">
                    {colItems.length === 0 ? (
                      <div className="text-center py-8 text-sand-400 text-xs italic bg-surface/50 rounded-lg border border-dashed border-sand-200">
                        No artifacts for {col.title}
                      </div>
                    ) : (
                      colItems.map((item) => (
                        <DeliverableCard
                          key={item.id}
                          item={item}
                          onInspect={() => setActiveModalItem(item)}
                          onCopy={() => handleCopyContent(item.content, item.id)}
                          isCopied={copiedId === item.id}
                          getTypeLabel={getTypeLabel}
                          getStatusBadge={getStatusBadge}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Timeline Flow Mode */
          <div className="space-y-4 max-w-4xl mx-auto py-2">
            {filteredItems.map((item, index) => (
              <div key={item.id} className="relative pl-6 sm:pl-8 group">
                {/* Timeline connector line */}
                {index !== filteredItems.length - 1 && (
                  <div className="absolute left-3 sm:left-4 top-8 bottom-0 w-0.5 bg-sand-200 group-hover:bg-brand-300 transition-colors" />
                )}
                {/* Timeline bullet icon */}
                <div className="absolute left-1.5 sm:left-2.5 top-2 w-3.5 h-3.5 rounded-full bg-surface border-2 border-brand-600 shadow-xs" />

                <div className="bg-surface rounded-xl border border-sand-200/90 shadow-2xs hover:shadow-xs p-4 transition-all">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-sand-100 text-sand-600 font-bold">
                        {item.version || 'v1.0'}
                      </span>
                      <span className="text-xs font-extrabold text-brand-700 bg-brand-50 px-2 py-0.5 rounded-md border border-brand-200">
                        {getTypeLabel(item.type)}
                      </span>
                      {getStatusBadge(item.status)}
                    </div>
                    <span className="text-[11px] text-sand-400 font-mono">
                      {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-sand-900 mt-2">{item.title}</h3>
                  <p className="text-xs text-sand-600 mt-1 line-clamp-2">{item.summary}</p>

                  {/* Flow Handover Banner */}
                  <div className="flex flex-wrap items-center justify-between gap-2 mt-3 pt-3 border-t border-sand-100 text-xs">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 font-semibold text-sand-700">
                        <span className="text-sand-400">By:</span>
                        <span>{item.agentName}</span>
                        <span className="text-[10px] text-sand-400">({item.role})</span>
                      </div>
                      {item.deliveredToName && (
                        <div className="flex items-center gap-1 font-semibold text-brand-700">
                          <ArrowRight className="w-3 h-3 text-brand-400" />
                          <span className="text-sand-400">Delivered to:</span>
                          <span>{item.deliveredToName}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopyContent(item.content, item.id)}
                        className="px-2.5 py-1 text-xs rounded-lg text-sand-600 hover:text-brand-700 hover:bg-sand-50 font-medium transition-colors flex items-center gap-1 cursor-pointer"
                        title="Copy deliverable contents"
                      >
                        {copiedId === item.id ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedId === item.id ? 'Copied' : 'Copy'}</span>
                      </button>
                      <button
                        onClick={() => setActiveModalItem(item)}
                        className="px-3 py-1 text-xs rounded-lg bg-brand-50 text-brand-700 hover:bg-brand-100 font-bold transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <span>Inspect Document</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Deliverable Document Inspector Modal */}
      {activeModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-scrim/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-surface rounded-2xl shadow-2xl border border-sand-200 max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-sand-200 flex items-start justify-between gap-4 bg-sand-50/80">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-brand-100 text-brand-800">
                    {getTypeLabel(activeModalItem.type)}
                  </span>
                  {getStatusBadge(activeModalItem.status)}
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-sand-200 text-sand-700">
                    {activeModalItem.version || 'v1.0'}
                  </span>
                  {activeModalItem.filePath && (
                    <span className="text-[11px] font-mono text-sand-500 truncate max-w-xs">
                      📁 {activeModalItem.filePath}
                    </span>
                  )}
                </div>
                <h3 className="text-base sm:text-lg font-extrabold text-sand-900 tracking-tight leading-snug">
                  {activeModalItem.title}
                </h3>
                <div className="flex flex-wrap items-center gap-2 text-xs text-sand-600 mt-1">
                  <span>Author: <strong>{activeModalItem.agentName}</strong> ({activeModalItem.role})</span>
                  {activeModalItem.deliveredToName && (
                    <span className="flex items-center gap-1 text-brand-700 font-semibold">
                      <ArrowRight className="w-3 h-3 text-brand-400" />
                      Delivered To: <strong>{activeModalItem.deliveredToName}</strong> ({activeModalItem.deliveredToRole || 'Recipient'})
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => setActiveModalItem(null)}
                className="p-1.5 rounded-lg text-sand-400 hover:text-sand-700 hover:bg-sand-200 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Tab Controls */}
            <div className="flex items-center justify-between px-5 pt-3 border-b border-sand-200 bg-surface">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setModalTab('preview')}
                  className={`pb-2.5 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
                    modalTab === 'preview'
                      ? 'border-brand-600 text-brand-700'
                      : 'border-transparent text-sand-500 hover:text-sand-800'
                  }`}
                >
                  Document Content
                </button>
                <button
                  onClick={() => setModalTab('raw')}
                  className={`pb-2.5 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
                    modalTab === 'raw'
                      ? 'border-brand-600 text-brand-700'
                      : 'border-transparent text-sand-500 hover:text-sand-800'
                  }`}
                >
                  Raw Code / Source
                </button>
                <button
                  onClick={() => setModalTab('metadata')}
                  className={`pb-2.5 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
                    modalTab === 'metadata'
                      ? 'border-brand-600 text-brand-700'
                      : 'border-transparent text-sand-500 hover:text-sand-800'
                  }`}
                >
                  Metadata & Handoff Audit
                </button>
              </div>

              <button
                onClick={() => handleCopyContent(activeModalItem.content, activeModalItem.id)}
                className="mb-2 text-xs font-semibold px-2.5 py-1 rounded-lg bg-sand-100 hover:bg-brand-50 text-sand-700 hover:text-brand-700 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {copiedId === activeModalItem.id ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Content</span>
                  </>
                )}
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 flex-1 overflow-y-auto bg-sand-50/50">
              {modalTab === 'preview' && (
                <div className="bg-surface p-5 rounded-xl border border-sand-200/90 shadow-2xs">
                  {activeModalItem.format === 'code' ? (
                    <pre className="theme-static text-xs font-mono bg-sand-900 text-sand-100 p-4 rounded-lg overflow-x-auto leading-relaxed">
                      <code>{activeModalItem.content}</code>
                    </pre>
                  ) : (
                    <div className="prose prose-sm max-w-none text-sand-800 whitespace-pre-wrap font-sans text-xs leading-relaxed">
                      {activeModalItem.content}
                    </div>
                  )}
                </div>
              )}

              {modalTab === 'raw' && (
                <pre className="theme-static text-xs font-mono bg-sand-900 text-emerald-400 p-4 rounded-xl overflow-x-auto leading-relaxed">
                  <code>{activeModalItem.content}</code>
                </pre>
              )}

              {modalTab === 'metadata' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-3 bg-surface rounded-xl border border-sand-200 shadow-2xs">
                      <span className="text-[10px] font-bold text-sand-400 uppercase tracking-wider">Created At</span>
                      <p className="text-xs font-mono font-semibold text-sand-800 mt-0.5">{activeModalItem.createdAt}</p>
                    </div>
                    <div className="p-3 bg-surface rounded-xl border border-sand-200 shadow-2xs">
                      <span className="text-[10px] font-bold text-sand-400 uppercase tracking-wider">Format</span>
                      <p className="text-xs font-mono font-semibold text-sand-800 mt-0.5 uppercase">{activeModalItem.format}</p>
                    </div>
                    <div className="p-3 bg-surface rounded-xl border border-sand-200 shadow-2xs">
                      <span className="text-[10px] font-bold text-sand-400 uppercase tracking-wider">File Path</span>
                      <p className="text-xs font-mono font-semibold text-sand-800 mt-0.5">{activeModalItem.filePath || 'None'}</p>
                    </div>
                    <div className="p-3 bg-surface rounded-xl border border-sand-200 shadow-2xs">
                      <span className="text-[10px] font-bold text-sand-400 uppercase tracking-wider">Sprint Identifier</span>
                      <p className="text-xs font-mono font-semibold text-sand-800 mt-0.5">{activeModalItem.sprintId || 'Current Active'}</p>
                    </div>
                  </div>

                  {activeModalItem.metadata && Object.keys(activeModalItem.metadata).length > 0 && (
                    <div className="p-4 bg-surface rounded-xl border border-sand-200 shadow-2xs">
                      <h4 className="text-xs font-bold text-sand-900 mb-2">Metrics & Telemetry</h4>
                      <pre className="text-xs font-mono bg-sand-100 p-3 rounded-lg text-sand-800 overflow-x-auto">
                        {JSON.stringify(activeModalItem.metadata, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3.5 px-5 bg-surface border-t border-sand-200 flex items-center justify-between">
              <span className="text-[11px] text-sand-500 font-mono">ID: {activeModalItem.id}</span>
              <button
                onClick={() => setActiveModalItem(null)}
                className="px-4 py-1.5 text-xs font-bold text-sand-700 hover:text-sand-900 bg-sand-100 hover:bg-sand-200 rounded-lg transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

interface DeliverableCardProps {
  item: RoleDeliverable;
  onInspect: () => void;
  onCopy: () => void;
  isCopied: boolean;
  getTypeLabel: (type: DeliverableType) => string;
  getStatusBadge: (status: DeliverableStatus) => React.ReactNode;
}

const DeliverableCard: React.FC<DeliverableCardProps> = ({
  item,
  onInspect,
  onCopy,
  isCopied,
  getTypeLabel,
  getStatusBadge,
}) => {
  return (
    <div className="bg-surface rounded-xl border border-sand-200/90 shadow-2xs hover:shadow-xs p-3 transition-all flex flex-col justify-between group">
      <div>
        {/* Top Badges */}
        <div className="flex items-center justify-between gap-1.5 mb-1.5">
          <span className="text-[10px] font-bold text-brand-700 bg-brand-50/90 px-2 py-0.5 rounded-md border border-brand-100 truncate">
            {getTypeLabel(item.type)}
          </span>
          {getStatusBadge(item.status)}
        </div>

        {/* Title */}
        <h4 className="text-xs font-extrabold text-sand-900 leading-tight group-hover:text-brand-600 transition-colors line-clamp-2">
          {item.title}
        </h4>

        {/* Summary Snippet */}
        <p className="text-[11px] text-sand-500 mt-1 line-clamp-2 leading-relaxed">
          {item.summary}
        </p>

        {/* Handover Flow Info */}
        <div className="mt-2.5 pt-2 border-t border-sand-100 space-y-1 text-[10px]">
          <div className="flex items-center justify-between text-sand-600">
            <span className="text-sand-400">Author:</span>
            <span className="font-semibold text-sand-800 truncate max-w-[130px]">{item.agentName}</span>
          </div>

          {item.deliveredToName && (
            <div className="flex items-center justify-between text-brand-700 font-medium">
              <span className="text-sand-400 flex items-center gap-0.5">
                <span>To:</span>
                <ArrowRight className="w-2.5 h-2.5 text-brand-400" />
              </span>
              <span className="font-bold text-brand-800 truncate max-w-[130px]">{item.deliveredToName}</span>
            </div>
          )}
        </div>

        {/* Metadata Badges */}
        {item.metadata && (
          <div className="flex flex-wrap items-center gap-1 mt-2">
            {item.metadata.acceptanceCriteriaCount !== undefined && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sand-100 text-sand-600">
                {item.metadata.acceptanceCriteriaCount} Criteria
              </span>
            )}
            {item.metadata.testCount !== undefined && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                {item.metadata.testCount} Tests ({item.metadata.testPassRate || '100%'})
              </span>
            )}
            {item.metadata.linesOfCode !== undefined && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                {item.metadata.linesOfCode} LOC
              </span>
            )}
            {item.metadata.securityChecksPassed !== undefined && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">
                {item.metadata.securityChecksPassed} Checks Passed
              </span>
            )}
            {item.metadata.coveragePercent !== undefined && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200">
                {item.metadata.coveragePercent}% Coverage
              </span>
            )}
          </div>
        )}
      </div>

      {/* Card Action Buttons */}
      <div className="flex items-center justify-between gap-1.5 mt-3 pt-2 border-t border-sand-100">
        <button
          onClick={onCopy}
          className="p-1 rounded-md text-sand-400 hover:text-sand-700 hover:bg-sand-100 transition-colors cursor-pointer"
          title="Copy markdown content"
        >
          {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
        </button>

        <button
          onClick={onInspect}
          className="w-full flex items-center justify-center gap-1 py-1 px-2 rounded-lg bg-brand-50 hover:bg-brand-100 text-brand-700 font-bold text-[11px] transition-colors cursor-pointer"
        >
          <span>Inspect Document</span>
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
