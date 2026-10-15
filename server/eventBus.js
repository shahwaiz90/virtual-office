const EventEmitter = require('events');
const path = require('path');
const { discoverAgents, getProjectRoot } = require('./agentDiscovery');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.events = [];
    this.maxEvents = 1000;
    this.wsClients = new Set();
    this.workflowStartTime = Date.now();
    const root = getProjectRoot();
    this.projectName = path.basename(root) || 'Active Project';
    this.workflowId = `WORKFLOW-${this.projectName.toUpperCase().replace(/[^A-Z0-9]/g, '-') || 'MAIN'}`;
    this.workflowTitle = `${this.projectName} Engineering Delivery`;
    this.currentPhase = 'Standby & Listening';
    this.latestMilestone = 'Virtual Office initialized. Agents seated at workstations, listening for commands.';
    this.latestMilestoneAgentId = 'project-manager';

    // Initialize agents
    this.agents = new Map();
    this.initAgents();

    // Clean initial Kanban state (awaits active agent tasks or demo trigger)
    this.tasks = new Map();

    // Active handoff in progress (for animation synchronization)
    this.activeHandoff = null;

    // Clean Analytics Maps (populated dynamically as tools/skills are invoked)
    this.toolUsageMap = new Map();
    this.skillUsageMap = new Map();
    this.roleInvocationMap = new Map();
    this.fileChanges = [];
    this.initStandbyRoleAnalytics();
    this.initDefaultFileChanges();
  }

  initAgents() {
    const discovered = discoverAgents();
    for (const a of discovered) {
      this.agents.set(a.id, a);
    }
  }

  initStandbyRoleAnalytics() {
    this.roleInvocationMap = new Map();
    for (const [agentId, agent] of this.agents.entries()) {
      this.roleInvocationMap.set(agentId, {
        agentId,
        agentName: agent.name,
        role: agent.role,
        invocations: 0,
        activeTimeSec: 0,
        completedTasks: 0,
        slaAdherenceRate: 100,
        status: 'available',
      });
    }
  }

  loadDemoTasks() {
    const agentList = Array.from(this.agents.values());
    if (agentList.length === 0) return;

    const pmAgent = agentList.find((a) => (a.id + ' ' + (a.role || '')).toLowerCase().match(/pm|manager|owner/)) || agentList[0];
    const leadAgent = agentList.find((a) => (a.id + ' ' + (a.role || '')).toLowerCase().match(/lead|architect/)) || agentList[1] || agentList[0];
    const devAgent = agentList.find((a) => (a.id + ' ' + (a.role || '')).toLowerCase().match(/dev|author|code/)) || agentList[2] || agentList[0];
    const testerAgent = agentList.find((a) => (a.id + ' ' + (a.role || '')).toLowerCase().match(/test|qa/)) || agentList[3] || agentList[0];

    const pmId = pmAgent.id;
    const pmRole = pmAgent.role || pmAgent.name;
    const leadId = leadAgent.id;
    const leadRole = leadAgent.role || leadAgent.name;
    const devId = devAgent.id;
    const devRole = devAgent.role || devAgent.name;
    const testerId = testerAgent.id;
    const testerRole = testerAgent.role || testerAgent.name;

    const initialTasks = [
      // 1. Intake & Sizing (Broken down by Stakeholder Intake -> PM)
      {
        id: 'TASK-1',
        key: `${pmAgent.badge || 'PM'}-101`,
        title: 'Ingest Ticket & Scope Requirements',
        description: 'Auto-ingest backlog issue, analyze constraints, and produce engineering specification',
        assignedTo: pmId,
        delegatedBy: 'stakeholder-intake',
        delegatedByRole: 'Project Stakeholder',
        column: 'done',
        skill: 'requirement-analysis',
        progress: 100,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'TASK-2',
        key: `${pmAgent.badge || 'PM'}-101`,
        title: 'Sprint Minute Estimation (<10m SLA)',
        description: 'Calculate granular minute estimations for Lead, Dev, and QA under 10m SLA',
        assignedTo: pmId,
        delegatedBy: pmId,
        delegatedByRole: pmRole,
        column: 'done',
        skill: 'sprint-planning',
        progress: 100,
        updatedAt: new Date().toISOString(),
      },

      // 2. Technical Architecture & Component Scoping (PM -> Technical Lead)
      {
        id: 'TASK-3',
        key: `${leadAgent.badge || 'LEAD'}-101`,
        title: 'Architecture Boundaries & Interface Contracts',
        description: 'Establish clean data layer contracts, state immutability, and boundary interfaces',
        assignedTo: leadId,
        delegatedBy: pmId,
        delegatedByRole: pmRole,
        column: 'done',
        skill: 'architecture',
        progress: 100,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'TASK-4',
        key: `${leadAgent.badge || 'LEAD'}-101`,
        title: 'Pre-map Impacted Modules & Direct File Paths',
        description: 'Analyze call graphs to pre-map files in architecture plan so Dev avoids repo searches',
        assignedTo: leadId,
        delegatedBy: pmId,
        delegatedByRole: pmRole,
        column: 'done',
        skill: 'impact-analysis',
        progress: 100,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'TASK-5',
        key: `${leadAgent.badge || 'LEAD'}-101`,
        title: 'Identify Business Rules & Author Unit Test Specs',
        description: 'Identify decision trees, edge cases, and define 100% required AAA unit test specs',
        assignedTo: leadId,
        delegatedBy: pmId,
        delegatedByRole: pmRole,
        column: 'in_progress',
        skill: 'tech-lead-planning',
        progress: 80,
        updatedAt: new Date().toISOString(),
      },

      // 3. Feature Implementation & Unit Test Authoring (Technical Lead -> Developer)
      {
        id: 'TASK-6',
        key: `${devAgent.badge || 'DEV'}-101`,
        title: 'Data Layer: Immutability DTOs & Service Client',
        description: 'Implement core domain DTOs with state immutability and repository caching',
        assignedTo: devId,
        delegatedBy: leadId,
        delegatedByRole: leadRole,
        column: 'in_progress',
        skill: 'feature-implementation',
        progress: 55,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'TASK-7',
        key: `${devAgent.badge || 'DEV'}-101`,
        title: 'Domain Provider: Business Logic Rules Engine',
        description: 'Implement domain feature provider orchestrating repository results and rule logic',
        assignedTo: devId,
        delegatedBy: leadId,
        delegatedByRole: leadRole,
        column: 'assigned',
        skill: 'feature-implementation',
        progress: 0,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'TASK-8',
        key: `${devAgent.badge || 'DEV'}-101`,
        title: 'Author 100% of Specified AAA Unit Tests',
        description: 'Implement unit test specs defined in architecture plan following AAA convention',
        assignedTo: devId,
        delegatedBy: leadId,
        delegatedByRole: leadRole,
        column: 'assigned',
        skill: 'unit-tests',
        progress: 0,
        updatedAt: new Date().toISOString(),
      },

      // 4. Code & Architecture Review (Developer -> Technical Lead)
      {
        id: 'TASK-9',
        key: 'REV-101',
        title: '10-Point Architectural Quality Gate Audit',
        description: 'Audit immutability, test coverage, and boundary compliance before handing to QA',
        assignedTo: leadId,
        delegatedBy: devId,
        delegatedByRole: devRole,
        column: 'review',
        skill: 'code-review',
        progress: 25,
        updatedAt: new Date().toISOString(),
      },

      // 5. Test Suite Verification (Technical Lead -> QA Tester)
      {
        id: 'TASK-10',
        key: `${testerAgent.badge || 'QA'}-101`,
        title: 'Execute Automated Test Suite & Regression Audit',
        description: 'Run unit test suite, verify 100% tests pass, and audit regression integrity',
        assignedTo: testerId,
        delegatedBy: leadId,
        delegatedByRole: leadRole,
        column: 'testing',
        skill: 'test-automation',
        progress: 0,
        updatedAt: new Date().toISOString(),
      },

      // 6. Stakeholder Delivery & Sign-Off (QA Tester -> Project Manager)
      {
        id: 'TASK-11',
        key: 'REL-101',
        title: 'Compile Delivery Sign-Off Report',
        description: 'Broadcast final delivery sign-off report with artifact diffs and SLA summary',
        assignedTo: pmId,
        delegatedBy: testerId,
        delegatedByRole: testerRole,
        column: 'backlog',
        skill: 'pm-reporting',
        progress: 0,
        updatedAt: new Date().toISOString(),
      },
    ];

    for (const t of initialTasks) {
      this.tasks.set(t.id, t);
    }
  }

  initDefaultToolAnalytics() {
    const defaultStats = [
      { toolName: 'read_jira.py', agentId: 'project-manager', count: 2, totalDurationSec: 14, lastUsedAt: new Date(Date.now() - 240000).toISOString() },
      { toolName: 'write_to_file', agentId: 'project-manager', count: 3, totalDurationSec: 22, lastUsedAt: new Date(Date.now() - 180000).toISOString() },
      { toolName: 'impact-analysis', agentId: 'android-tech-lead', count: 4, totalDurationSec: 58, lastUsedAt: new Date(Date.now() - 140000).toISOString() },
      { toolName: 'view_file', agentId: 'android-tech-lead', count: 8, totalDurationSec: 36, lastUsedAt: new Date(Date.now() - 120000).toISOString() },
      { toolName: 'replace_file_content', agentId: 'android-dev', count: 6, totalDurationSec: 112, lastUsedAt: new Date(Date.now() - 75000).toISOString() },
      { toolName: 'compileDebugKotlin', agentId: 'android-dev', count: 2, totalDurationSec: 42, lastUsedAt: new Date(Date.now() - 40000).toISOString() },
      { toolName: 'git diff', agentId: 'android-tech-lead', count: 3, totalDurationSec: 18, lastUsedAt: new Date(Date.now() - 25000).toISOString() },
      { toolName: 'testDebugUnitTest', agentId: 'android-tester', count: 3, totalDurationSec: 64, lastUsedAt: new Date(Date.now() - 10000).toISOString() },
    ];

    for (const s of defaultStats) {
      const key = `${s.agentId}::${s.toolName}`;
      const agent = this.agents.get(s.agentId);
      this.toolUsageMap.set(key, {
        toolName: s.toolName,
        agentId: s.agentId,
        agentName: agent ? agent.name : s.agentId,
        agentRole: agent ? agent.role : 'Specialist',
        count: s.count,
        totalDurationSec: s.totalDurationSec,
        lastUsedAt: s.lastUsedAt,
      });
    }
  }

  recordToolUsage(agentId, toolName, durationSec = 3) {
    if (!toolName) return;
    const cleanTool = toolName.trim();
    const key = `${agentId}::${cleanTool}`;
    const agent = this.agents.get(agentId);

    const existing = this.toolUsageMap.get(key) || {
      toolName: cleanTool,
      agentId,
      agentName: agent ? agent.name : agentId,
      agentRole: agent ? agent.role : 'Specialist',
      count: 0,
      totalDurationSec: 0,
      lastUsedAt: new Date().toISOString(),
    };

    existing.count += 1;
    existing.totalDurationSec += Math.max(1, durationSec);
    existing.lastUsedAt = new Date().toISOString();
    this.toolUsageMap.set(key, existing);
  }

  initDefaultSkillAnalytics() {
    const defaultSkills = [
      { skillId: '00-requirement-analysis', skillName: 'PRD Scoping & Jira Ingestion', count: 2, totalDurationSec: 36, agentId: 'project-manager' },
      { skillId: 'pm-reporting', skillName: 'Minute Estimation & Sign-Off Reporting', count: 3, totalDurationSec: 42, agentId: 'project-manager' },
      { skillId: 'tech-lead-planning', skillName: '5-Tier Architecture Scoping', count: 4, totalDurationSec: 88, agentId: 'android-tech-lead' },
      { skillId: 'impact-analysis', skillName: 'Pre-mapped Impact Analysis', count: 3, totalDurationSec: 62, agentId: 'android-tech-lead' },
      { skillId: '04-repository', skillName: 'Data Layer & ApiExecuterV2', count: 3, totalDurationSec: 94, agentId: 'android-dev' },
      { skillId: '03a-provider', skillName: 'Domain Provider & Rules Engine', count: 2, totalDurationSec: 76, agentId: 'android-dev' },
      { skillId: '08-unit-tests', skillName: 'AAA JUnit & MockK Tests', count: 5, totalDurationSec: 130, agentId: 'android-dev' },
      { skillId: '10-code-review', skillName: '10-Point Architectural Quality Gate', count: 2, totalDurationSec: 48, agentId: 'android-tech-lead' },
      { skillId: 'test-execution', skillName: 'Gradle Test Execution & Regression', count: 3, totalDurationSec: 64, agentId: 'android-tester' },
    ];

    for (const sk of defaultSkills) {
      const agent = this.agents.get(sk.agentId);
      this.skillUsageMap.set(sk.skillId, {
        skillId: sk.skillId,
        skillName: sk.skillName,
        count: sk.count,
        totalDurationSec: sk.totalDurationSec,
        lastUsedByAgentId: sk.agentId,
        lastUsedByAgentName: agent ? agent.name : sk.agentId,
      });
    }
  }

  recordSkillUsage(skillId, agentId, durationSec = 10) {
    if (!skillId) return;
    const cleanId = skillId.trim();
    const agent = this.agents.get(agentId);

    const existing = this.skillUsageMap.get(cleanId) || {
      skillId: cleanId,
      skillName: cleanId,
      count: 0,
      totalDurationSec: 0,
      lastUsedByAgentId: agentId,
      lastUsedByAgentName: agent ? agent.name : agentId,
    };

    existing.count += 1;
    existing.totalDurationSec += Math.max(1, durationSec);
    existing.lastUsedByAgentId = agentId;
    if (agent) existing.lastUsedByAgentName = agent.name;
    this.skillUsageMap.set(cleanId, existing);
  }

  initDefaultRoleAnalytics() {
    const roles = [
      { agentId: 'project-manager', invocations: 5, activeTimeSec: 78, completedTasks: 2, slaAdherenceRate: 100 },
      { agentId: 'android-tech-lead', invocations: 8, activeTimeSec: 198, completedTasks: 3, slaAdherenceRate: 98 },
      { agentId: 'android-dev', invocations: 12, activeTimeSec: 342, completedTasks: 3, slaAdherenceRate: 95 },
      { agentId: 'android-tester', invocations: 4, activeTimeSec: 86, completedTasks: 2, slaAdherenceRate: 100 },
    ];

    for (const r of roles) {
      const agent = this.agents.get(r.agentId);
      this.roleInvocationMap.set(r.agentId, {
        agentId: r.agentId,
        agentName: agent ? agent.name : r.agentId,
        role: agent ? agent.role : 'Specialist',
        invocations: r.invocations,
        activeTimeSec: r.activeTimeSec,
        completedTasks: r.completedTasks,
        slaAdherenceRate: r.slaAdherenceRate,
        status: agent ? agent.status : 'available',
      });
    }
  }

  recordRoleInvocation(agentId, durationSec = 5) {
    if (!agentId) return;
    const agent = this.agents.get(agentId);

    const existing = this.roleInvocationMap.get(agentId) || {
      agentId,
      agentName: agent ? agent.name : agentId,
      role: agent ? agent.role : 'Specialist',
      invocations: 0,
      activeTimeSec: 0,
      completedTasks: 0,
      slaAdherenceRate: 100,
      status: 'working',
    };

    existing.invocations += 1;
    existing.activeTimeSec += Math.max(1, durationSec);
    if (agent) {
      existing.agentName = agent.name;
      existing.role = agent.role;
      existing.status = agent.status;
    }
    this.roleInvocationMap.set(agentId, existing);
  }

  initDefaultFileChanges() {
    this.fileChanges = [];
    const agentList = Array.from(this.agents.values());
    const findAgent = (q, fallbackIdx) => {
      const match = agentList.find(
        (a) =>
          (a.id && a.id.toLowerCase().includes(q)) ||
          (a.role && a.role.toLowerCase().includes(q))
      );
      return match || agentList[fallbackIdx % (agentList.length || 1)] || { id: 'developer', name: 'Developer', role: 'Software Engineer' };
    };

    const dev = findAgent('dev', 2);
    const lead = findAgent('lead', 1);
    const tester = findAgent('test', 3);

    const now = Date.now();
    const records = [
      {
        id: 'fc-1',
        filePath: 'app/src/main/java/com/stc/business/ui/screens/CompanyProfileScreen.kt',
        fileName: 'CompanyProfileScreen.kt',
        action: 'modified',
        agentId: dev.id,
        agentName: dev.name,
        agentRole: dev.role,
        timestamp: new Date(now - 120000).toISOString(),
        summary: 'Added reactive company data state binding and walkthrough overlay anchor point',
        instruction: 'Bind ViewModel StateFlow to Compose UI and inject WalkthroughTooltip anchor',
        linesAdded: 38,
        contentPreview: `@Composable
fun CompanyProfileScreen(
    viewModel: CompanyProfileViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val scaffoldState = rememberScaffoldState()

    Scaffold(
        scaffoldState = scaffoldState,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.company_profile_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { paddingValues ->
        Box(modifier = Modifier.fillMaxSize().padding(paddingValues)) {
            when (val state = uiState) {
                is CompanyUiState.Loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                is CompanyUiState.Success -> {
                    CompanyContent(
                        company = state.company,
                        modifier = Modifier.walkthroughAnchor("company_card_step")
                    )
                }
                is CompanyUiState.Error -> ErrorBanner(message = state.message)
            }
        }
    }
}`,
      },
      {
        id: 'fc-2',
        filePath: 'app/src/main/java/com/stc/business/ui/components/WalkThroughOverlay.kt',
        fileName: 'WalkThroughOverlay.kt',
        action: 'created',
        agentId: dev.id,
        agentName: dev.name,
        agentRole: dev.role,
        timestamp: new Date(now - 240000).toISOString(),
        summary: 'Created full-screen walkthrough spotlight mask with smooth alpha transitions',
        instruction: 'Implement WalkThroughOverlay with canvas clip path and pulse animation',
        linesAdded: 45,
        contentPreview: `@Composable
fun WalkThroughOverlay(
    activeStep: WalkThroughStep?,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier
) {
    if (activeStep == null) return

    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val pulseScale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1.08f,
        animationSpec = infiniteRepeatable(
            animation = tween(900, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulseScale"
    )

    Canvas(modifier = modifier.fillMaxSize().clickable { onDismiss() }) {
        val targetRect = activeStep.bounds ?: return@Canvas
        drawRect(color = Color.Black.copy(alpha = 0.65f))
        drawCircle(
            color = Color.Transparent,
            radius = (targetRect.maxDimension / 2f + 16.dp.toPx()) * pulseScale,
            center = targetRect.center,
            blendMode = BlendMode.Clear
        )
    }
}`,
      },
      {
        id: 'fc-3',
        filePath: 'app/src/test/java/com/stc/business/ui/screens/CompanyProfileViewModelTest.kt',
        fileName: 'CompanyProfileViewModelTest.kt',
        action: 'created',
        agentId: tester.id,
        agentName: tester.name,
        agentRole: tester.role,
        timestamp: new Date(now - 360000).toISOString(),
        summary: 'Authored AAA unit tests for ViewModel StateFlow emission and error recovery',
        instruction: 'Add unit tests ensuring CompanyUiState emits Success and handles network exceptions',
        linesAdded: 32,
        contentPreview: `@OptIn(ExperimentalCoroutinesApi::class)
class CompanyProfileViewModelTest {
    @get:Rule val mainDispatcherRule = MainDispatcherRule()
    private val repository = mockk<CompanyRepository>()

    @Test
    fun \`when repository succeeds uiState emits Success with company data\`() = runTest {
        val fakeCompany = Company(id = "comp_99", name = "STC Business Solutions")
        coEvery { repository.fetchCompanyDetails("comp_99") } returns Result.success(fakeCompany)

        val viewModel = CompanyProfileViewModel(repository)
        viewModel.loadCompany("comp_99")

        viewModel.uiState.test {
            assertEquals(CompanyUiState.Loading, awaitItem())
            val success = awaitItem() as CompanyUiState.Success
            assertEquals("STC Business Solutions", success.company.name)
        }
    }
}`,
      },
      {
        id: 'fc-4',
        filePath: 'docs/architecture/walkthrough-component-spec.md',
        fileName: 'walkthrough-component-spec.md',
        action: 'modified',
        agentId: lead.id,
        agentName: lead.name,
        agentRole: lead.role,
        timestamp: new Date(now - 480000).toISOString(),
        summary: 'Pre-mapped UI anchor coordinates, boundary contracts, and unit test specifications',
        instruction: 'Define interface contract for WalkThroughCoordinator and state machine',
        linesAdded: 25,
        contentPreview: `### Walkthrough Component Architecture Specification
- **Coordinator**: \`WalkThroughCoordinator\` observes global user progression.
- **State Machine**: Unidirectional flow: \`Idle\` -> \`Active(step)\` -> \`Transitioning\` -> \`Completed\`.
- **Spotlight Bounds**: Screen-relative \`Rect\` measured via \`onGloballyPositioned\` modifier.
- **Testing Contract**: 100% coverage on state transitions and back-press dismissal.`,
      },
    ];

    for (const rec of records) {
      this.recordFileChange(rec);
    }
  }

  recordFileChange(change) {
    if (!change || !change.filePath) return;
    const fName = change.fileName || path.basename(change.filePath);
    const content = change.contentPreview || change.codeContent || change.replacementContent || '';
    const record = {
      id: change.id || `fc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      filePath: change.filePath,
      fileName: fName,
      action: change.action || 'modified',
      agentId: change.agentId || 'developer',
      agentName: change.agentName || 'Developer',
      agentRole: change.agentRole || 'Developer',
      timestamp: change.timestamp || new Date().toISOString(),
      summary: change.summary || change.details || `Updated ${fName}`,
      instruction: change.instruction || '',
      contentPreview: content,
      previousContent: change.previousContent || change.targetContent || '',
      linesAdded: change.linesAdded || (content ? content.split('\n').length : 1),
    };

    // Avoid duplicate rapid recordings of the exact same content within the file
    const existingIdx = this.fileChanges.findIndex(
      (f) => f.filePath === record.filePath && f.contentPreview === record.contentPreview
    );
    if (existingIdx !== -1) {
      this.fileChanges[existingIdx] = record;
    } else {
      this.fileChanges.unshift(record);
      if (this.fileChanges.length > 200) {
        this.fileChanges.pop();
      }
    }
    return record;
  }

  registerWsClient(ws) {
    this.wsClients.add(ws);
    // Send initial snapshot on connection
    ws.send(JSON.stringify({
      type: 'SYNC_STATE',
      data: this.getStateSnapshot(),
    }));

    ws.on('close', () => {
      this.wsClients.delete(ws);
    });
  }

  broadcast(message) {
    const raw = typeof message === 'string' ? message : JSON.stringify(message);
    for (const client of this.wsClients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        try {
          client.send(raw);
        } catch (e) {
          console.error('[EventBus] Error broadcasting to client:', e);
        }
      }
    }
  }

  /**
   * Sanitizes strings to never expose credentials, keys, or passwords
   */
  sanitize(text) {
    if (!text || typeof text !== 'string') return text;
    return text
      .replace(/(?:key|token|secret|password|bearer|auth)[=:\s]+['"]?([a-zA-Z0-9_\-\.]{8,})['"]?/gi, '***REDACTED***')
      .replace(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, '***REDACTED_JWT***');
  }

  /**
   * Normalized event emission
   */
  emitEvent(rawEvent) {
    const eventId = rawEvent.eventId || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const timestamp = rawEvent.timestamp || new Date().toISOString();
    const agentId = rawEvent.agentId || 'project-manager';
    const type = rawEvent.type || 'INFO';
    const payload = rawEvent.payload || {};

    // Sanitize payload fields
    if (payload.command) payload.command = this.sanitize(payload.command);
    if (payload.output) payload.output = this.sanitize(payload.output);
    if (payload.details) payload.details = this.sanitize(payload.details);

    const normalized = {
      eventId,
      workflowId: rawEvent.workflowId || this.workflowId,
      sessionId: rawEvent.sessionId || 'session_default',
      agentId,
      type,
      timestamp,
      payload,
    };

    // Update in-memory event list
    this.events.unshift(normalized);
    if (this.events.length > this.maxEvents) {
      this.events.pop();
    }

    // Apply side effects to state
    this.applyEventSideEffects(normalized);

    // Broadcast event to browser visualizer
    this.broadcast({
      type: 'EVENT',
      data: normalized,
      state: this.getStateSnapshot(),
    });

    this.emit('event', normalized);
    return normalized;
  }

  applyEventSideEffects(event) {
    const { agentId, type, payload } = event;
    const agent = this.agents.get(agentId);

    // 1. Milestone updates
    if (type === 'milestone_update' || payload.milestone) {
      this.latestMilestone = payload.milestone || payload.details || this.latestMilestone;
      this.latestMilestoneAgentId = payload.milestoneAgentId || payload.agentId || agentId || this.latestMilestoneAgentId || 'project-manager';
    }

    // 2. Phase transitions
    if (payload.phase) {
      this.currentPhase = payload.phase;
    }

    // 3. Agent handoff animations
    if (type === 'agent_handoff' || payload.handoffTo) {
      const fromId = payload.fromAgent || agentId;
      const toId = payload.toAgent || payload.handoffTo;
      const taskTitle = payload.task || payload.taskTitle || 'Task Delegation';

      const fromAgent = this.agents.get(fromId);
      const toAgent = this.agents.get(toId);

      if (fromAgent && toAgent) {
        fromAgent.status = 'delegating';
        fromAgent.activityMessage = `Handing off: ${taskTitle} to ${toAgent.name}`;
        toAgent.status = 'waiting';
        toAgent.activityMessage = `Awaiting handoff from ${fromAgent.name}`;

        this.activeHandoff = {
          id: `handoff_${Date.now()}`,
          fromId,
          toId,
          fromPos: { ...fromAgent.currentPosition },
          toPos: { ...toAgent.theme.deskPosition },
          taskTitle,
          skill: payload.allowedSkill || 'General',
          startedAt: Date.now(),
          durationMs: 3000,
        };

        // Complete handoff after animation period
        setTimeout(() => {
          if (this.activeHandoff && this.activeHandoff.id.startsWith('handoff_')) {
            this.activeHandoff = null;
            if (toAgent) {
              toAgent.status = 'working';
              toAgent.activityMessage = `Accepted task: ${taskTitle}`;
              toAgent.currentTask = taskTitle;
            }
            if (fromAgent) {
              fromAgent.status = 'available';
              fromAgent.activityMessage = `Delegated ${taskTitle} successfully`;
            }
            this.broadcast({
              type: 'STATE_UPDATE',
              state: this.getStateSnapshot(),
            });
          }
        }, 3200);

        // Record role invocation and skill usage on handoff
        this.recordRoleInvocation(fromId, 6);
        this.recordRoleInvocation(toId, 10);
        if (payload.allowedSkill) {
          this.recordSkillUsage(payload.allowedSkill, toId, 15);
        }
      }
    }

    // 4. Tool & command executions
    if (agent) {
      if (payload.task) {
        if (!agent.currentTask || agent.currentTask !== payload.task) {
          agent.taskStartedAt = new Date().toISOString();
          agent.taskCompletedAt = null;
          agent.taskDurationSec = null;
        }
        agent.currentTask = payload.task;
      }
      if (payload.file) agent.currentFile = payload.file;
      if (payload.tool) agent.lastTool = payload.tool;

      // Auto initialize taskStartedAt if working starts without explicit task change
      if (!agent.taskStartedAt && (type === 'tool_executing' || type === 'command_executing' || type === 'file_modified' || type === 'planning_started')) {
        agent.taskStartedAt = new Date().toISOString();
      }

      switch (type) {
        case 'tool_executing':
        case 'tool_started':
          agent.status = 'working';
          agent.lastTool = payload.tool || agent.lastTool;
          agent.activityMessage = `Running tool: ${payload.tool || 'Action'}`;
          this.recordToolUsage(agentId, payload.tool || 'tool_execution', 5);
          break;

        case 'command_executing':
          agent.status = payload.command && payload.command.includes('test') ? 'testing' : 'coding';
          agent.activityMessage = `Executing: ${payload.command ? payload.command.substring(0, 45) : 'Terminal command'}`;
          {
            const cmdName = payload.command ? payload.command.split(' ')[0] : 'terminal_command';
            this.recordToolUsage(agentId, cmdName, 8);
          }
          break;

        case 'file_modified':
          agent.status = 'coding';
          agent.currentFile = payload.file;
          agent.activityMessage = `Editing: ${payload.file ? payload.file.split('/').pop() : 'Codebase'}`;
          this.recordToolUsage(agentId, payload.tool || 'replace_file_content', 6);
          break;

        case 'planning_started':
          agent.status = 'planning';
          agent.activityMessage = 'Designing 5-tier architecture & pre-mapping files';
          this.recordToolUsage(agentId, payload.tool || 'impact-analysis', 12);
          break;

        case 'task_completed':
          agent.status = 'celebrating';
          agent.activityMessage = `🎉 Done: ${payload.task || 'Task complete!'}`;
          agent.taskCompletedAt = new Date().toISOString();
          if (agent.taskStartedAt) {
            const dur = Math.max(1, Math.round((new Date(agent.taskCompletedAt).getTime() - new Date(agent.taskStartedAt).getTime()) / 1000));
            agent.taskDurationSec = dur;
            agent.totalWorkTimeSec = (agent.totalWorkTimeSec || 0) + dur;
          }
          setTimeout(() => {
            if (agent.status === 'celebrating') {
              agent.status = 'available';
              agent.activityMessage = 'Ready at workstation';
              this.broadcast({ type: 'STATE_UPDATE', state: this.getStateSnapshot() });
            }
          }, 5000);
          break;

        case 'test_result':
          if (payload.testsFailed > 0) {
            agent.status = 'error';
            agent.activityMessage = `Tests Failed: ${payload.testsFailed} errors`;
          } else {
            agent.status = 'celebrating';
            agent.activityMessage = `🎉 All ${payload.testsPassed || 'unit'} tests passed green!`;
            agent.taskCompletedAt = new Date().toISOString();
            if (agent.taskStartedAt) {
              const dur = Math.max(1, Math.round((new Date(agent.taskCompletedAt).getTime() - new Date(agent.taskStartedAt).getTime()) / 1000));
              agent.taskDurationSec = dur;
              agent.totalWorkTimeSec = (agent.totalWorkTimeSec || 0) + dur;
            }
            setTimeout(() => {
              if (agent.status === 'celebrating') {
                agent.status = 'available';
                agent.activityMessage = 'Ready at workstation';
                this.broadcast({ type: 'STATE_UPDATE', state: this.getStateSnapshot() });
              }
            }, 5000);
          }
          break;

        case 'error':
          agent.status = 'error';
          agent.activityMessage = `Error: ${payload.details || 'Task issue detected'}`;
          break;
      }
      agent.updatedAt = new Date().toISOString();
    }

    // 5. Universal File Change Recording (captures both recognized agents and dynamic subagents)
    if (type === 'file_modified' && payload && payload.file) {
      const fName = payload.fileName || path.basename(payload.file);
      this.recordFileChange({
        filePath: payload.file,
        fileName: fName,
        action: payload.action || (payload.tool === 'write_to_file' ? 'created' : 'modified'),
        agentId,
        agentName: agent ? agent.name : (agentId || 'Developer'),
        agentRole: agent ? agent.role : 'Developer',
        timestamp: event.timestamp || new Date().toISOString(),
        summary: payload.details || payload.instruction || `Updated ${fName}`,
        instruction: payload.instruction || '',
        contentPreview: payload.contentPreview || payload.codeContent || payload.replacementContent || '',
        previousContent: payload.previousContent || payload.targetContent || '',
        linesAdded: payload.linesAdded || (payload.contentPreview ? payload.contentPreview.split('\n').length : undefined),
      });
    }

    // 6. Update or auto-create Kanban tasks
    if (payload.taskId) {
      if (!this.tasks.has(payload.taskId)) {
        this.tasks.set(payload.taskId, {
          id: payload.taskId,
          key: payload.key || 'TASK-1',
          title: payload.task || 'Active Task',
          description: payload.details || 'Task executing in workspace',
          assignedTo: agentId,
          delegatedBy: 'orchestrator',
          delegatedByRole: 'AI Agent',
          column: payload.column || 'in_progress',
          skill: payload.tool || 'coding',
          progress: payload.progress || 25,
          updatedAt: new Date().toISOString(),
        });
      }
      const task = this.tasks.get(payload.taskId);
      if (task) {
        if (payload.column) {
          task.column = payload.column;
          // Trigger celebration on assigned agent when a task transitions to 'done'
          if (payload.column === 'done' && agent && agent.status !== 'error') {
            agent.status = 'celebrating';
            agent.activityMessage = `🎉 Done: ${task.title}`;
            agent.taskCompletedAt = new Date().toISOString();
            if (agent.taskStartedAt) {
              const dur = Math.max(1, Math.round((new Date(agent.taskCompletedAt).getTime() - new Date(agent.taskStartedAt).getTime()) / 1000));
              agent.taskDurationSec = dur;
              agent.totalWorkTimeSec = (agent.totalWorkTimeSec || 0) + dur;
            }
            setTimeout(() => {
              if (agent.status === 'celebrating') {
                agent.status = 'available';
                agent.activityMessage = 'Ready at workstation';
                this.broadcast({ type: 'STATE_UPDATE', state: this.getStateSnapshot() });
              }
            }, 5000);
          }
        }
        if (payload.progress !== undefined) task.progress = payload.progress;
        if (payload.assignedTo) task.assignedTo = payload.assignedTo;
        if (payload.task) task.title = payload.task;
        task.updatedAt = new Date().toISOString();
      }
    }

    // 6. Feature Delivery & Completion Auto-Resolution:
    // When the Project Manager or workflow transitions to 'Delivered', or announces delivery/signoff,
    // or when type === 'task_completed', automatically complete ALL open tasks on the board!
    const isFeatureDelivered =
      this.currentPhase === 'Delivered' ||
      type === 'task_completed' ||
      (payload.phase && /deliver/i.test(payload.phase)) ||
      (payload.milestone && /deliver|sign-?off|all tasks complete|feature delivered|shipped/i.test(payload.milestone));

    if (isFeatureDelivered) {
      for (const [id, task] of this.tasks.entries()) {
        if (task.column !== 'done') {
          task.column = 'done';
          task.progress = 100;
          task.updatedAt = new Date().toISOString();
        }
      }
    }

    // Auto-complete test and review tasks when test result is successful
    if (type === 'test_result' && (!payload.testsFailed || payload.testsFailed === 0)) {
      for (const [id, task] of this.tasks.entries()) {
        if (task.column === 'testing' || task.column === 'review' || id === 'DELIV-3' || id === 'DELIV-4') {
          task.column = 'done';
          task.progress = 100;
          task.updatedAt = new Date().toISOString();
        }
      }
    }
  }

  getStateSnapshot() {
    const agentsList = Array.from(this.agents.values());
    const tasksList = Array.from(this.tasks.values());

    const activeCount = agentsList.filter(a => a.status !== 'available' && a.status !== 'waiting').length;
    const waitingCount = agentsList.filter(a => a.status === 'available' || a.status === 'waiting').length;
    const completedTasks = tasksList.filter(t => t.column === 'done').length;
    const failedTasks = agentsList.filter(a => a.status === 'error').length;

    return {
      workflow: {
        id: this.workflowId,
        projectName: this.projectName,
        title: this.workflowTitle,
        phase: this.currentPhase,
        startTime: this.workflowStartTime,
        elapsedSeconds: Math.floor((Date.now() - this.workflowStartTime) / 1000),
        milestone: this.latestMilestone,
        milestoneAgentId: this.latestMilestoneAgentId || 'project-manager',
      },
      metrics: {
        totalAgents: agentsList.length,
        activeAgents: activeCount,
        waitingAgents: waitingCount,
        completedTasks,
        failedTasks,
        totalTasks: tasksList.length,
      },
      agents: agentsList,
      tasks: tasksList,
      toolUsageAnalytics: Array.from(this.toolUsageMap.values()).sort((a, b) => b.totalDurationSec - a.totalDurationSec),
      skillUsageAnalytics: Array.from(this.skillUsageMap.values()).sort((a, b) => b.count - a.count),
      roleInvocationAnalytics: Array.from(this.roleInvocationMap.values()).sort((a, b) => b.invocations - a.invocations),
      fileChanges: this.fileChanges,
      activeHandoff: this.activeHandoff,
      connectedViewers: this.wsClients.size,
    };
  }

  loadDemoWorkflow(workflowTitle = 'DEMO: FEATURE-101 (User Authentication Service)') {
    this.workflowStartTime = Date.now();
    this.workflowTitle = workflowTitle;
    this.currentPhase = 'Intake & Planning';
    this.latestMilestone = '⚠️ SIMULATION DEMO STARTED: Ingesting FEATURE-101.';
    this.latestMilestoneAgentId = 'project-manager';
    this.initAgents();
    this.tasks = new Map();
    this.loadDemoTasks();
    this.toolUsageMap = new Map();
    this.initDefaultToolAnalytics();
    this.skillUsageMap = new Map();
    this.initDefaultSkillAnalytics();
    this.roleInvocationMap = new Map();
    this.initDefaultRoleAnalytics();
    this.initDefaultFileChanges();
    this.activeHandoff = null;
    this.broadcast({
      type: 'SYNC_STATE',
      data: this.getStateSnapshot(),
    });
  }

  resetWorkflow(workflowTitle) {
    return this.loadDemoWorkflow(workflowTitle);
  }

  clearState() {
    this.events = [];
    this.tasks = new Map();
    this.toolUsageMap = new Map();
    this.skillUsageMap = new Map();
    this.fileChanges = [];
    this.activeHandoff = null;
    this.workflowStartTime = Date.now();
    this.currentPhase = 'Standby & Listening';
    this.latestMilestone = 'Office state cleared. Standing by for new agent tasks.';
    this.latestMilestoneAgentId = 'project-manager';

    for (const [id, agent] of this.agents.entries()) {
      agent.status = 'available';
      agent.currentTask = null;
      agent.currentFile = null;
      agent.activityMessage = 'Ready at workstation';
      agent.taskStartedAt = null;
      agent.taskCompletedAt = null;
      agent.taskDurationSec = null;
    }

    this.initStandbyRoleAnalytics();

    this.broadcast({
      type: 'SYNC_STATE',
      data: this.getStateSnapshot(),
    });
  }
}

// Singleton event bus instance
const globalEventBus = new EventBus();

module.exports = {
  EventBus,
  eventBus: globalEventBus,
};
