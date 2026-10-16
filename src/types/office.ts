export type AgentStatus =
  | 'available'
  | 'idle'
  | 'working'
  | 'handoff'
  | 'planning'
  | 'coding'
  | 'testing'
  | 'reviewing'
  | 'delegating'
  | 'waiting'
  | 'celebrating'
  | 'error';

export interface SkillMetadata {
  id: string;
  name: string;
  description: string;
  summary?: string;
  path: string;
}

export interface AgentTheme {
  themeColor: string;
  lightColor: string;
  badge: string;
  hairColor: string;
  skinColor: string;
  clothingColor: string;
  accessory: string;
  station: string;
  stationName: string;
  deskPosition: { x: number; y: number };
  roomBounds?: { x: number; y: number; w: number; h: number };
  avatarUrl?: string;
  facing: 'north' | 'south' | 'east' | 'west';
  isPrimary?: boolean;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  isPrimary?: boolean;
  isSubagent?: boolean;
  avatarUrl?: string;
  avatar_url?: string;
  aliases: string[];
  badge?: string;
  badgeText: string;
  activeRoleBadge: string;
  description: string;
  skills: SkillMetadata[];
  skillIds: string[];
  allowedTools: string[];
  prohibitedActions: string[];
  delegationTargets: string[];
  delegation_targets?: string[];
  theme: AgentTheme;
  status: AgentStatus;
  currentTask: string | null;
  currentFile: string | null;
  lastTool: string | null;
  delegatedBy: string | null;
  parentAgent: string | null;
  currentPosition: { x: number; y: number };
  targetPosition: { x: number; y: number };
  activityMessage: string;
  taskStartedAt?: string | null;
  taskCompletedAt?: string | null;
  taskDurationSec?: number | null;
  totalWorkTimeSec?: number;
  updatedAt: string;
}

export type TaskColumn = 'backlog' | 'assigned' | 'in_progress' | 'review' | 'testing' | 'done';

export interface KanbanTask {
  id: string;
  key: string;
  title: string;
  description: string;
  assignedTo: string;
  delegatedBy?: string;
  delegatedByRole?: string;
  column: TaskColumn;
  skill: string;
  progress: number;
  createdAt?: string;
  updatedAt: string;
  logs?: string[];
  /** 'requirement' for the user's request; 'task' (default) for work broken out of it */
  type?: 'requirement' | 'task';
  /** Card this task was broken out of */
  parentKey?: string;
  /** Instructions written by the delegator for the assignee's role (the handoff message) */
  brief?: string;
  acceptanceCriteria?: string[];
  dependsOn?: string[];
  context?: string | { files?: string[]; decisions?: string[]; links?: string[]; notes?: string };
  /** Agent-to-agent conversation on this card */
  thread?: TaskThreadEntry[];
  /** What the assignee delivered */
  result?: string;
}

export type TaskThreadKind = 'handoff' | 'question' | 'answer' | 'update' | 'decision' | 'result' | 'status';

export interface TaskThreadEntry {
  id: string;
  agentId: string;
  kind: TaskThreadKind;
  text: string;
  to?: string;
  at: string;
}

export interface NormalizedEvent {
  eventId: string;
  workflowId: string;
  sessionId: string;
  agentId: string;
  type: string;
  timestamp: string;
  payload: {
    task?: string;
    taskTitle?: string;
    tool?: string;
    file?: string;
    command?: string;
    output?: string;
    status?: string;
    details?: string;
    fromAgent?: string;
    toAgent?: string;
    handoffFrom?: string;
    handoffFromName?: string;
    handoffFromRole?: string;
    fromBadge?: string;
    handoffTo?: string;
    handoffToName?: string;
    handoffToRole?: string;
    toBadge?: string;
    allowedSkill?: string;
    phase?: string;
    milestone?: string;
    testsPassed?: number;
    testsFailed?: number;
    taskId?: string;
    column?: TaskColumn;
    progress?: number;
    assignedTo?: string;
    delegatedBy?: string;
    delegatedByRole?: string;
    key?: string;
    [key: string]: any;
  };
}

export interface ActiveHandoff {
  id: string;
  fromId: string;
  toId: string;
  fromName?: string;
  fromRole?: string;
  fromBadge?: string;
  toName?: string;
  toRole?: string;
  toBadge?: string;
  fromPos: { x: number; y: number };
  toPos: { x: number; y: number };
  taskTitle: string;
  skill: string;
  startedAt: number;
  durationMs: number;
}

export interface ToolUsageStat {
  toolName: string;
  agentId: string;
  agentName: string;
  agentRole: string;
  count: number;
  totalDurationSec: number;
  lastUsedAt: string;
}

export interface SkillUsageStat {
  skillId: string;
  skillName: string;
  count: number;
  totalDurationSec: number;
  lastUsedByAgentId: string;
  lastUsedByAgentName: string;
}

export interface RoleInvocationStat {
  agentId: string;
  agentName: string;
  role: string;
  invocations: number;
  activeTimeSec: number;
  completedTasks: number;
  slaAdherenceRate: number; // percentage
  status: string;
}

export interface FileChangeRecord {
  id: string;
  filePath: string;
  fileName: string;
  action: 'created' | 'modified' | 'refactored';
  agentId: string;
  agentName: string;
  agentRole: string;
  timestamp: string;
  summary?: string;
  instruction?: string;
  contentPreview?: string;
  previousContent?: string;
  linesAdded?: number;
}

export interface AgentCommunication {
  id: string;
  fromAgentId: string;
  fromAgentName: string;
  fromAgentRole: string;
  toAgentId: string;
  toAgentName: string;
  toAgentRole: string;
  taskTitle?: string;
  taskKey?: string;
  message: string;
  channel?: 'direct_message' | 'subagent_delegation' | 'pr_review' | 'qa_handoff' | 'system';
  timestamp: string;
}

export interface SprintInfo {
  id: string;
  number: number;
  name: string;
  path: string;
  status: 'active' | 'completed' | 'planned' | string;
  createdAt: string;
}

export interface JiraConfluenceItem {
  id: string;
  sourceType: 'jira' | 'confluence';
  ticketKey?: string | null;
  pageId?: string | null;
  url?: string | null;
  title?: string;
  summary?: string;
  status?: string;
  command?: string | null;
  timestamp: string;
  agentId?: string | null;
  details?: string;
}

export type DeliverableType =
  | 'prd'
  | 'implementation_plan'
  | 'source_code'
  | 'test_report'
  | 'architecture'
  | 'code_review'
  | 'release_signoff';

export type DeliverableStatus = 'draft' | 'in_review' | 'delivered' | 'approved';

export interface DeliverableMetadata {
  wordCount?: number;
  testPassRate?: string;
  testCount?: number;
  coveragePercent?: number;
  linesOfCode?: number;
  acceptanceCriteriaCount?: number;
  securityChecksPassed?: number;
  targetPlatform?: string;
  [key: string]: any;
}

export interface RoleDeliverable {
  id: string;
  title: string;
  type: DeliverableType;
  role: string;
  roleSlug: 'pm' | 'tech-lead' | 'dev' | 'qa' | 'specialist';
  agentId: string;
  agentName: string;
  status: DeliverableStatus;
  summary: string;
  content: string;
  format: 'markdown' | 'code' | 'json';
  filePath?: string;
  version: string;
  sprintId?: string;
  deliveredTo?: string;
  deliveredToName?: string;
  deliveredToRole?: string;
  metadata?: DeliverableMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface OfficeState {
  workflow: {
    id: string;
    projectName?: string;
    projectPath?: string;
    platform?: string;
    title: string;
    phase: string;
    startTime: number;
    elapsedSeconds: number;
    milestone: string;
    milestoneAgentId?: string;
    isDemoRunning?: boolean;
    hasAgents?: boolean;
  };
  metrics: {
    totalAgents: number;
    activeAgents: number;
    waitingAgents: number;
    completedTasks: number;
    failedTasks: number;
    totalTasks: number;
  };
  agents: Agent[];
  tasks: KanbanTask[];
  deliverables?: RoleDeliverable[];
  activeSprintId?: string;
  activeSprintPath?: string;
  sprints?: SprintInfo[];
  toolUsageAnalytics?: ToolUsageStat[];
  skillUsageAnalytics?: SkillUsageStat[];
  roleInvocationAnalytics?: RoleInvocationStat[];
  fileChanges?: FileChangeRecord[];
  communications?: AgentCommunication[];
  jiraConfluenceItems?: JiraConfluenceItem[];
  activeHandoff: ActiveHandoff | null;
  connectedViewers: number;
  isDemoRunning?: boolean;
  hasCustomAgentsConfig?: boolean;
  events?: any[];
}

