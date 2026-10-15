export type AgentStatus =
  | 'available'
  | 'working'
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
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  avatarUrl?: string;
  aliases: string[];
  badgeText: string;
  activeRoleBadge: string;
  description: string;
  skills: SkillMetadata[];
  skillIds: string[];
  allowedTools: string[];
  prohibitedActions: string[];
  delegationTargets: string[];
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
  updatedAt: string;
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
    handoffTo?: string;
    allowedSkill?: string;
    phase?: string;
    milestone?: string;
    testsPassed?: number;
    testsFailed?: number;
    taskId?: string;
    column?: TaskColumn;
    progress?: number;
  };
}

export interface ActiveHandoff {
  id: string;
  fromId: string;
  toId: string;
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

export interface OfficeState {
  workflow: {
    id: string;
    projectName?: string;
    title: string;
    phase: string;
    startTime: number;
    elapsedSeconds: number;
    milestone: string;
    milestoneAgentId?: string;
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
  toolUsageAnalytics?: ToolUsageStat[];
  skillUsageAnalytics?: SkillUsageStat[];
  roleInvocationAnalytics?: RoleInvocationStat[];
  fileChanges?: FileChangeRecord[];
  activeHandoff: ActiveHandoff | null;
  connectedViewers: number;
}
