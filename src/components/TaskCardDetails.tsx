import React from 'react';
import { Agent, KanbanTask, TaskThreadEntry, TaskThreadKind } from '../types/office';
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  FileText,
  FolderOpen,
  GitBranch,
  Layers,
  ListChecks,
  MessageSquare,
  Send,
  Trophy,
} from 'lucide-react';

interface TaskCardDetailsProps {
  task: KanbanTask;
  tasks: KanbanTask[];
  agents: Agent[];
  onOpenTask: (task: KanbanTask) => void;
}

const KIND_STYLE: Record<TaskThreadKind, { label: string; className: string }> = {
  request: { label: 'Request', className: 'bg-brand-50 text-brand-700 border-brand-200' },
  handoff: { label: 'Handoff', className: 'bg-brand-100 text-brand-800 border-brand-200' },
  question: { label: 'Question', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  answer: { label: 'Answer', className: 'bg-olive-100 text-olive-800 border-olive-200' },
  update: { label: 'Update', className: 'bg-sand-100 text-sand-700 border-sand-200' },
  decision: { label: 'Decision', className: 'bg-clay-100 text-clay-800 border-clay-200' },
  result: { label: 'Result', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  status: { label: 'Status', className: 'bg-sand-100 text-sand-600 border-sand-200' },
};

const COLUMN_LABEL: Record<string, string> = {
  backlog: 'Backlog',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  review: 'Review',
  testing: 'Testing',
  done: 'Done',
};

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-bold uppercase tracking-wider text-sand-400 mb-1.5 flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-sand-500" />
        <span>{title}</span>
      </h4>
      {children}
    </div>
  );
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return iso;
  }
}

/**
 * Everything agents said to each other about one card: the brief handed over, what "done" means,
 * the context provided, the conversation on the thread, and the delivered result.
 */
export const TaskCardDetails: React.FC<TaskCardDetailsProps> = ({ task, tasks, agents, onOpenTask }) => {
  const agentById = (id?: string) => agents.find((a) => a.id === id);
  const taskByKey = (key: string) => tasks.find((t) => t.key === key);
  const parent = task.parentKey ? taskByKey(task.parentKey) : undefined;
  const children = tasks.filter((t) => t.parentKey && t.parentKey === task.key);
  const thread = task.thread || [];
  const context = task.context;

  const AgentChip = ({ id }: { id?: string }) => {
    const ag = agentById(id);
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-sand-800">
        {ag && (
          <img
            src={ag.avatar_url || ag.avatarUrl || '/assets/developer.png'}
            alt=""
            className="w-4 h-4 rounded-full object-cover border border-sand-200"
          />
        )}
        <span>{ag ? ag.name : id || 'Unknown'}</span>
        {ag?.role && <span className="font-normal text-sand-400">({ag.role})</span>}
      </span>
    );
  };

  const CardLink = ({ t }: { t: KanbanTask }) => (
    <button
      type="button"
      onClick={() => onOpenTask(t)}
      className="w-full text-left flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface border border-sand-200 hover:border-brand-300 hover:bg-brand-50/60 transition-colors cursor-pointer"
    >
      <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-sand-100 text-sand-700 shrink-0">{t.key}</span>
      <span className="text-xs text-sand-800 truncate flex-1">{t.title}</span>
      <span className="text-[10px] text-sand-500 shrink-0">{agentById(t.assignedTo)?.name || t.assignedTo}</span>
      <span className="text-[10px] font-semibold text-sand-600 shrink-0">{COLUMN_LABEL[t.column] || t.column}</span>
    </button>
  );

  return (
    <div className="space-y-5">
      {/* Handoff chain: who asked whom */}
      <div className="flex flex-wrap items-center gap-2 text-xs p-3 rounded-xl bg-sand-50 border border-sand-200/70">
        {task.type === 'requirement' ? (
          <>
            <span className="text-sand-500">Requested by</span>
            <span className="font-semibold text-sand-800">{task.delegatedByRole || 'User'}</span>
            <ArrowRight className="w-3.5 h-3.5 text-sand-400" />
            <AgentChip id={task.assignedTo} />
          </>
        ) : (
          <>
            <AgentChip id={task.delegatedBy} />
            <ArrowRight className="w-3.5 h-3.5 text-sand-400" />
            <AgentChip id={task.assignedTo} />
          </>
        )}
      </div>

      {parent && (
        <Section icon={GitBranch} title={parent.type === 'requirement' ? 'Requirement' : 'Part of'}>
          <CardLink t={parent} />
        </Section>
      )}

      {task.brief ? (
        <Section icon={Send} title="Brief for this role">
          <div className="p-3.5 rounded-xl bg-brand-50/60 border border-brand-200/70 text-xs sm:text-sm text-sand-800 leading-relaxed whitespace-pre-line">
            {task.brief}
          </div>
        </Section>
      ) : null}

      {task.description && task.description !== task.brief && (
        <Section icon={Layers} title={task.type === 'requirement' ? 'Requirement' : 'Description'}>
          <div className="p-3.5 rounded-xl bg-sand-50 border border-sand-200/70 text-xs sm:text-sm text-sand-700 leading-relaxed whitespace-pre-line">
            {task.description}
          </div>
        </Section>
      )}

      {task.acceptanceCriteria && task.acceptanceCriteria.length > 0 && (
        <Section icon={ListChecks} title={`Acceptance criteria (${task.acceptanceCriteria.length})`}>
          <ul className="space-y-1.5">
            {task.acceptanceCriteria.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-xs sm:text-sm text-sand-700">
                {task.column === 'done' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <Circle className="w-4 h-4 text-sand-300 shrink-0 mt-0.5" />
                )}
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {context && (
        <Section icon={FolderOpen} title="Context">
          <div className="p-3 rounded-xl bg-sand-50 border border-sand-200/70 text-xs text-sand-700 space-y-2">
            {typeof context === 'string' ? (
              <p className="whitespace-pre-line">{context}</p>
            ) : (
              <>
                {context.files && context.files.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {context.files.map((f) => (
                      <span key={f} className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-surface border border-sand-200 text-sand-800">
                        {f}
                      </span>
                    ))}
                  </div>
                )}
                {context.decisions && context.decisions.length > 0 && (
                  <ul className="list-disc pl-4 space-y-0.5">
                    {context.decisions.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                )}
                {context.links && context.links.length > 0 && (
                  <ul className="space-y-0.5">
                    {context.links.map((l) => (
                      <li key={l} className="truncate text-brand-700">{l}</li>
                    ))}
                  </ul>
                )}
                {context.notes && <p className="whitespace-pre-line">{context.notes}</p>}
              </>
            )}
          </div>
        </Section>
      )}

      {task.dependsOn && task.dependsOn.length > 0 && (
        <Section icon={GitBranch} title="Depends on">
          <div className="space-y-1.5">
            {task.dependsOn.map((k) => {
              const dep = taskByKey(k);
              return dep ? (
                <CardLink key={k} t={dep} />
              ) : (
                <div key={k} className="text-xs text-sand-500 font-mono">{k} (not on this sprint's board)</div>
              );
            })}
          </div>
        </Section>
      )}

      {children.length > 0 && (
        <Section icon={Layers} title={`Broken down into (${children.length})`}>
          <div className="space-y-1.5">
            {children.map((c) => (
              <CardLink key={c.id} t={c} />
            ))}
          </div>
        </Section>
      )}

      <Section icon={MessageSquare} title={`Agent conversation (${thread.length})`}>
        {thread.length === 0 ? (
          <div className="p-4 rounded-xl bg-sand-50 border border-dashed border-sand-200 text-center text-xs text-sand-400 italic">
            No messages on this card yet. Handoffs, questions, decisions and results posted by agents appear here.
          </div>
        ) : (
          <ol className="space-y-2.5">
            {thread.map((m: TaskThreadEntry) => {
              const style = KIND_STYLE[m.kind] || KIND_STYLE.update;
              return (
                <li key={m.id} className="p-3 rounded-xl bg-surface border border-sand-200/80">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] mb-1.5">
                    <span className={`px-1.5 py-0.5 rounded border font-bold ${style.className}`}>{style.label}</span>
                    <AgentChip id={m.agentId} />
                    {m.to && (
                      <>
                        <ArrowRight className="w-3 h-3 text-sand-400" />
                        <AgentChip id={m.to} />
                      </>
                    )}
                    <span className="ml-auto text-sand-400">{formatTime(m.at)}</span>
                  </div>
                  <p className="text-xs sm:text-sm text-sand-700 leading-relaxed whitespace-pre-line">{m.text}</p>
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      {task.result && (
        <Section icon={Trophy} title="Result">
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs sm:text-sm text-sand-800 leading-relaxed whitespace-pre-line">
            {task.result}
          </div>
        </Section>
      )}

      {!task.brief && !task.acceptanceCriteria?.length && task.type !== 'requirement' && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
          <FileText className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            This card has no brief or acceptance criteria. The delegating agent handed it over without writing them on the
            board (see the kanban-handoff skill).
          </span>
        </div>
      )}
    </div>
  );
};
