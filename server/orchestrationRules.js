/**
 * server/orchestrationRules.js
 * 
 * OrchestrationRules Engine
 * 
 * Centralizes multi-agent team role resolution, normalization of AI-produced task breakdowns,
 * event transition side-effect rules, and seed demo templates.
 * Decouples business logic from the EventBus transport layer.
 */

class OrchestrationRules {
  /**
   * Resolves the 4 core team roles (Primary Orchestrator, Tech Lead, Developer, QA)
   * from any Map or Array of configured agents.
   * 
   * Strict ID-First Hierarchy (Zero Regex on Mutable Display Names/Roles):
   * 1. Primary Orchestrator (PM): Explicitly flagged `is_primary` or `isPrimary`, ID matching ('tech-pm', '*-pm', 'pm'), or 1st agent in roster.
   * 2. Tech Lead (LEAD): ID matching ('*-tech-lead', '*-lead', 'tech-lead', 'lead'), or `enable_subagent_tools: true` / `invoke_subagent` tool permission, or badge 'LEAD'.
   * 3. Core Developer (DEV): ID matching ('*-dev', '*-developer', 'dev', 'developer'), or badge 'DEV'.
   * 4. QA Engineer (QA): ID matching ('*-tester', '*-qa', 'tester', 'qa'), or badge 'QA'/'TEST'.
   * 5. Deterministic fallback: Uses sequential array indices without guessing on arbitrary text.
   */
  static resolveTeamRoles(agentsMapOrList) {
    const list = Array.isArray(agentsMapOrList)
      ? agentsMapOrList
      : Array.from(agentsMapOrList ? agentsMapOrList.values() : []);

    if (!list || list.length === 0) {
      const fallback = { id: 'agent-1', name: 'Agent', role: 'Specialist', badge: 'AGT' };
      return { pm: fallback, lead: fallback, dev: fallback, tester: fallback, platformBadge: 'TSK', list: [] };
    }

    // Helper for clean, deterministic ID matching (exact or suffix)
    const hasId = (a, exactList, suffixList) => {
      if (!a || !a.id) return false;
      const id = String(a.id).toLowerCase();
      if (exactList.includes(id)) return true;
      return suffixList.some((s) => id.endsWith(s));
    };

    // 1. Primary Orchestrator (PM / Scrum Master)
    // Priority:
    // a. Explicit is_primary / isPrimary flag (stamped by Team Studio "Make 1st" or 1st in roster)
    // b. Canonical ID: 'tech-pm', 'pm', 'scrum-master', or ending in '-pm'
    // c. Badge: 'PM', 'SM'
    // d. Array position fallback: list[0]
    const pm =
      list.find((a) => a.is_primary === true || a.isPrimary === true) ||
      list.find((a) => hasId(a, ['tech-pm', 'pm', 'scrum-master'], ['-pm', '-scrum-master'])) ||
      list.find((a) => a.badge === 'PM' || a.badge === 'SM') ||
      list[0];

    // 2. Technical Lead (delegation lead, subagent coordinator)
    // Exclude PM. Priority:
    // a. Canonical ID: 'android-tech-lead', 'ios-tech-lead', 'web-tech-lead', 'tech-lead', 'lead', or ending in '-tech-lead' / '-lead'
    // b. Capability: has subagent tools enabled or 'invoke_subagent' allowed
    // c. Badge: 'LEAD'
    // d. Array position fallback: First non-PM agent in list
    const lead =
      list.find(
        (a) =>
          a.id !== pm.id &&
          (hasId(a, ['android-tech-lead', 'ios-tech-lead', 'web-tech-lead', 'tech-lead', 'lead'], ['-tech-lead', '-lead']) ||
           a.enable_subagent_tools === true ||
           (Array.isArray(a.allowed_tools) && a.allowed_tools.includes('invoke_subagent')) ||
           (Array.isArray(a.tools) && a.tools.includes('invoke_subagent')) ||
           a.badge === 'LEAD')
      ) ||
      list.find((a) => a.id !== pm.id) ||
      list[1] ||
      list[0];

    // 3. Core Developer (implementation specialist)
    // Exclude PM and Lead. Priority:
    // a. Canonical ID: 'android-dev', 'ios-dev', 'web-dev', 'dev', 'developer', or ending in '-dev' / '-developer'
    // b. Badge: 'DEV'
    // c. Array position fallback: First non-PM, non-Lead agent in list
    const dev =
      list.find(
        (a) =>
          a.id !== pm.id &&
          a.id !== lead.id &&
          (hasId(a, ['android-dev', 'ios-dev', 'web-dev', 'dev', 'developer'], ['-dev', '-developer']) ||
           a.badge === 'DEV')
      ) ||
      list.find((a) => a.id !== pm.id && a.id !== lead.id) ||
      list[2] ||
      list[0];

    // 4. QA Specialist / Tester (verification specialist)
    // Exclude PM, Lead, and Dev. Priority:
    // a. Canonical ID: 'android-tester', 'ios-tester', 'web-tester', 'tester', 'qa', or ending in '-tester' / '-qa'
    // b. Badge: 'QA', 'TEST'
    // c. Array position fallback: First remaining agent in list
    const tester =
      list.find(
        (a) =>
          a.id !== pm.id &&
          a.id !== lead.id &&
          a.id !== dev.id &&
          (hasId(a, ['android-tester', 'ios-tester', 'web-tester', 'tester', 'qa'], ['-tester', '-qa']) ||
           a.badge === 'QA' ||
           a.badge === 'TEST')
      ) ||
      list.find((a) => a.id !== pm.id && a.id !== lead.id && a.id !== dev.id) ||
      list[3] ||
      list[0];

    // 5. Platform Badge Inference purely by Agent ID prefixes
    let platformBadge = 'TSK';
    if (list.some((a) => (a.id || '').toLowerCase().startsWith('android-') || (a.id || '').toLowerCase() === 'android')) {
      platformBadge = 'AND';
    } else if (list.some((a) => (a.id || '').toLowerCase().startsWith('ios-') || (a.id || '').toLowerCase() === 'ios')) {
      platformBadge = 'IOS';
    } else if (list.some((a) => (a.id || '').toLowerCase().startsWith('web-') || (a.id || '').toLowerCase() === 'web')) {
      platformBadge = 'WEB';
    }

    return {
      pm,
      lead,
      dev,
      tester,
      platformBadge,
      list,
    };
  }

  /**
   * Infers communication channel based strictly on agent IDs
   */
  static inferChannel(fromId = '', toId = '', explicitChannel) {
    if (explicitChannel) return explicitChannel;
    const f = String(fromId).toLowerCase();
    const t = String(toId).toLowerCase();
    if ((f.endsWith('-dev') || f === 'dev') && (t.endsWith('-lead') || t.endsWith('-tech-lead') || t === 'lead')) {
      return 'pr_review';
    }
    if (f.endsWith('-tester') || f.endsWith('-qa') || t.endsWith('-tester') || t.endsWith('-qa')) {
      return 'qa_handoff';
    }
    return 'subagent_delegation';
  }

  /**
   * Light, non-destructive cleanup of a title the AI/agent produced.
   * Only strips markdown decoration and whitespace, and caps length.
   * It NEVER maps keywords to canned titles or rewrites the agent's wording.
   */
  static distillShortTopic(goal, maxLen = 80) {
    if (!goal || typeof goal !== 'string') return '';
    const clean = goal
      .replace(/\r?\n/g, ' ')
      .replace(/^[\s#*`"'>\-]+|[\s*`"']+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (clean.length <= maxLen) return clean;
    const cut = clean.slice(0, maxLen - 1);
    const lastSpace = cut.lastIndexOf(' ');
    return `${(lastSpace > maxLen / 2 ? cut.slice(0, lastSpace) : cut).trim()}…`;
  }

  /**
   * Returns the highest numeric suffix used by existing task keys (e.g. WEB-214 -> 214).
   */
  static highestKeyNumber(existingTasks) {
    const list = Array.isArray(existingTasks)
      ? existingTasks
      : Array.from(existingTasks ? existingTasks.values() : []);
    let max = 100;
    for (const t of list) {
      const m = String((t && t.key) || '').match(/-(\d+)$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return max;
  }

  /**
   * Normalizes a task list produced by the AI / orchestrating agent so it can be placed on the board.
   * - Any number of tasks (no fixed count, no fixed stages).
   * - Titles, descriptions, skills and order are preserved exactly as the AI wrote them.
   * - Assignees must exist in the roster; unknown assignees fall back to the orchestrator's first
   *   delegation target (or the orchestrator itself) instead of a guessed "stage" role.
   * - Missing keys are generated as <PREFIX>-<next number>.
   */
  static normalizeAITasks(aiTasks, agentsMapOrList, options = {}) {
    if (!Array.isArray(aiTasks)) return [];
    const { pm, platformBadge, list } = this.resolveTeamRoles(agentsMapOrList);
    const byId = new Map(list.map((a) => [String(a.id).toLowerCase(), a]));
    const findAgent = (ref) => {
      if (!ref) return null;
      const r = String(ref).toLowerCase().trim();
      return byId.get(r) || list.find((a) => (a.name && a.name.toLowerCase() === r)) || null;
    };
    const pmTargets = pm.delegation_targets || pm.handoffTo || pm.delegationTargets || [];
    const defaultAssignee = findAgent(pmTargets[0]) || pm;

    const prefix = options.keyPrefix || platformBadge;
    let next = this.highestKeyNumber(options.existingTasks) + 1;
    const now = new Date().toISOString();
    const stamp = Date.now();
    const validColumns = ['backlog', 'assigned', 'in_progress', 'review', 'testing', 'done'];

    const out = [];
    aiTasks.forEach((t, idx) => {
      if (!t || typeof t !== 'object') return;
      const title = this.distillShortTopic(String(t.title || ''));
      if (!title) return;
      const assigned = findAgent(t.assignedTo || t.assignee || t.agent) || defaultAssignee;
      const delegator = findAgent(t.delegatedBy) || (assigned.id === pm.id ? { id: 'user', role: 'User' } : pm);
      const key = t.key ? String(t.key).trim() : `${prefix}-${next++}`;
      const column = validColumns.includes(t.column) ? t.column : 'backlog';
      out.push({
        id: t.id || `TASK-${key}`,
        key,
        title,
        description: String(t.description || title),
        acceptanceCriteria: Array.isArray(t.acceptanceCriteria) ? t.acceptanceCriteria : undefined,
        dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn : undefined,
        assignedTo: assigned.id,
        delegatedBy: delegator.id,
        delegatedByRole: delegator.role || delegator.name,
        column,
        skill: t.skill || undefined,
        progress: typeof t.progress === 'number' ? t.progress : (column === 'done' ? 100 : 0),
        order: idx,
        createdAt: now,
        updatedAt: now,
        batchId: options.batchId || String(stamp),
      });
    });
    return out;
  }

  /**
   * Registers a raw user requirement on the board WITHOUT inventing a breakdown.
   * Used only when no AI breakdown is available: a single backlog intake card that holds the
   * requirement verbatim and is owned by the primary orchestrator, who must break it down.
   * (Backlog-first policy.) No Plan/Build/Review/Test templates are generated here.
   */
  static decomposeSprintGoal(goal, agentsMapOrList, options = {}) {
    const cleanGoal = (goal || '').trim();
    if (!cleanGoal) return [];
    const { pm, platformBadge } = this.resolveTeamRoles(agentsMapOrList);
    const key = `${options.keyPrefix || platformBadge}-${this.highestKeyNumber(options.existingTasks) + 1}`;
    const now = new Date().toISOString();
    return [
      {
        id: `TASK-${key}`,
        key,
        title: this.distillShortTopic(cleanGoal),
        description: cleanGoal,
        assignedTo: pm.id,
        delegatedBy: 'user',
        delegatedByRole: 'User',
        column: 'backlog',
        skill: 'task-decomposition',
        progress: 0,
        needsBreakdown: true,
        createdAt: now,
        updatedAt: now,
      },
    ];
  }

  /**
   * Generates initial demo sprint tasks (TASK-1 to TASK-5) based on resolved team roles.
   */
  static getInitialDemoTasks(agentsMapOrList) {
    const { pm, lead, dev, tester } = this.resolveTeamRoles(agentsMapOrList);
    const now = new Date().toISOString();

    return [
      {
        id: 'TASK-1',
        key: `${pm.badge || 'PM'}-101`,
        title: 'US-101: Sprint Intake & User Story Scope',
        description: 'Ingest backlog ticket US-101, formulate Acceptance Criteria, and evaluate Definition of Ready (DoR)',
        assignedTo: pm.id,
        delegatedBy: 'stakeholder-intake',
        delegatedByRole: 'Project Stakeholder',
        column: 'assigned',
        skill: 'sprint-planning',
        progress: 15,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'TASK-2',
        key: `${lead.badge || 'LEAD'}-101`,
        title: 'Technical Architecture Spike & Boundary Design',
        description: 'Design component contracts, immutability domain boundaries, and author AAA unit test specifications',
        assignedTo: lead.id,
        delegatedBy: pm.id,
        delegatedByRole: pm.role || pm.name,
        column: 'backlog',
        skill: 'architecture-planning',
        progress: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'TASK-3',
        key: `${dev.badge || 'DEV'}-101`,
        title: 'Core Implementation & Test Authoring',
        description: 'Implement AuthService with strict state immutability, integrate token handling, and author AAA unit test scenarios',
        assignedTo: dev.id,
        delegatedBy: lead.id,
        delegatedByRole: lead.role || lead.name,
        column: 'backlog',
        skill: 'feature-implementation',
        progress: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'TASK-4',
        key: `${tester.badge || 'QA'}-101`,
        title: 'Automated Regression & Acceptance Verification',
        description: 'Execute automated regression test suite against Acceptance Criteria and certify zero regressions',
        assignedTo: tester.id,
        delegatedBy: lead.id,
        delegatedByRole: lead.role || lead.name,
        column: 'backlog',
        skill: 'automated-testing',
        progress: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'TASK-5',
        key: 'REL-101',
        title: 'Demo Agentic Workflow Acceptance & Delivery Sign-Off',
        description: 'Verify deliverable against Definition of Done (DoD), complete Sprint Review, and broadcast delivery sign-off',
        assignedTo: pm.id,
        delegatedBy: tester.id,
        delegatedByRole: tester.role || tester.name,
        column: 'backlog',
        skill: 'pm-reporting',
        progress: 0,
        createdAt: now,
        updatedAt: now,
      },
    ];
  }

  /**
   * Generates mock demo file changes parameterized with current team developers.
   */
  static getDefaultFileChanges(agentsMapOrList) {
    const { dev, lead, tester } = this.resolveTeamRoles(agentsMapOrList);
    const now = Date.now();

    return [
      {
        id: 'fc-1',
        filePath: 'app/src/main/java/com/enterprise/business/ui/screens/CompanyProfileScreen.kt',
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
        filePath: 'app/src/main/java/com/enterprise/business/ui/components/WalkThroughOverlay.kt',
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
    val alphaAnim by animateFloatAsState(
        targetValue = 1f,
        animationSpec = tween(durationMillis = 350, easing = FastOutSlowInEasing)
    )

    Canvas(modifier = modifier.fillMaxSize().clickable { onDismiss() }) {
        val targetBounds = activeStep.boundsInRoot
        drawRect(color = Color.Black.copy(alpha = 0.65f * alphaAnim))
        drawCircle(
            color = Color.Transparent,
            radius = (targetBounds.maxDimension / 2f) + 16.dp.toPx(),
            center = targetBounds.center,
            blendMode = BlendMode.Clear
        )
    }
}`,
      },
      {
        id: 'fc-3',
        filePath: 'app/src/test/java/com/enterprise/business/viewmodel/CompanyProfileViewModelTest.kt',
        fileName: 'CompanyProfileViewModelTest.kt',
        action: 'created',
        agentId: tester.id,
        agentName: tester.name,
        agentRole: tester.role,
        timestamp: new Date(now - 60000).toISOString(),
        summary: 'Authored AAA test suite verifying loading and success states',
        instruction: 'Unit test CompanyProfileViewModel StateFlow transitions using Turbine',
        linesAdded: 52,
        contentPreview: `@Test
fun \`uiState emits Loading then Success when repository returns valid company\`() = runTest {
    val fakeCompany = Company(id = "101", name = "Global Enterprise Solutions")
    coEvery { getCompanyUseCase("101") } returns Result.success(fakeCompany)

    viewModel.uiState.test {
        assertEquals(CompanyUiState.Loading, awaitItem())
        val success = awaitItem() as CompanyUiState.Success
        assertEquals("Global Enterprise Solutions", success.company.name)
        cancelAndIgnoreRemainingEvents()
    }
}`,
      },
    ];
  }

  /**
   * Generates mock demo communications between the resolved team roles.
   */
  static getDefaultCommunications(agentsMapOrList) {
    const { pm, lead, dev, tester } = this.resolveTeamRoles(agentsMapOrList);
    const now = Date.now();

    return [
      {
        id: 'comm-1',
        fromAgentId: pm.id,
        fromAgentName: pm.name,
        fromAgentRole: pm.role,
        toAgentId: lead.id,
        toAgentName: lead.name,
        toAgentRole: lead.role,
        taskKey: 'US-101',
        taskTitle: 'Technical Architecture Spike & Boundary Contracts',
        message: `Sprint 42 committed for User Story US-101 (User Authentication Service). Please formulate technical architecture spike, immutability contracts for UserSession, and test boundary specifications under 7-minute SLA.`,
        channel: 'subagent_delegation',
        timestamp: new Date(now - 300000).toISOString(),
      },
      {
        id: 'comm-2',
        fromAgentId: lead.id,
        fromAgentName: lead.name,
        fromAgentRole: lead.role,
        toAgentId: dev.id,
        toAgentName: dev.name,
        toAgentRole: dev.role,
        taskKey: 'DEV-101',
        taskTitle: 'Feature Implementation & Unit Tests',
        message: 'Architecture contracts locked in architecture-plan.md. Implement AuthService session validation with immutable DTOs and author 100% AAA unit tests with zero mutable state leaks.',
        channel: 'subagent_delegation',
        timestamp: new Date(now - 240000).toISOString(),
      },
      {
        id: 'comm-3',
        fromAgentId: dev.id,
        fromAgentName: dev.name,
        fromAgentRole: dev.role,
        toAgentId: lead.id,
        toAgentName: lead.name,
        toAgentRole: lead.role,
        taskKey: 'PR-101',
        taskTitle: 'Sprint PR Review & Definition of Done (DoD) Inspection',
        message: 'Pull Request #101 submitted. AuthService implemented with token verification and Map-based session cache. 18 AAA unit tests authored and passing green (100% boundary coverage). Ready for code review against DoD.',
        channel: 'pr_review',
        timestamp: new Date(now - 180000).toISOString(),
      },
      {
        id: 'comm-4',
        fromAgentId: lead.id,
        fromAgentName: lead.name,
        fromAgentRole: lead.role,
        toAgentId: pm.id,
        toAgentName: pm.name,
        toAgentRole: pm.role,
        taskKey: 'DOD-101',
        taskTitle: 'DoD Verified & Handover for Acceptance Testing',
        message: `PR #101 approved. SOLID principles verified, 100% unit tests passing green, and zero mutable state leaks confirmed. Handing over approved deliverable to ${pm.name} for QA acceptance dispatch.`,
        channel: 'pr_review',
        timestamp: new Date(now - 120000).toISOString(),
      },
      {
        id: 'comm-5',
        fromAgentId: pm.id,
        fromAgentName: pm.name,
        fromAgentRole: pm.role,
        toAgentId: tester.id,
        toAgentName: tester.name,
        toAgentRole: tester.role,
        taskKey: 'QA-101',
        taskTitle: 'Sprint Acceptance Criteria & Automated Regression Verification',
        message: 'User Story US-101 dispatched for automated regression and Acceptance Criteria verification. Execute automated test suite across authentication session boundaries.',
        channel: 'qa_handoff',
        timestamp: new Date(now - 60000).toISOString(),
      },
      {
        id: 'comm-6',
        fromAgentId: tester.id,
        fromAgentName: tester.name,
        fromAgentRole: tester.role,
        toAgentId: pm.id,
        toAgentName: pm.name,
        toAgentRole: pm.role,
        taskKey: 'SIGN-101',
        taskTitle: 'Demo Agentic Workflow & Acceptance Criteria Sign-Off',
        message: 'Automated test suite completed: 18 / 18 Acceptance Criteria tests passed green with 0 regressions. Sprint deliverable certified against DoD and ready for Demo Agentic Workflow sign-off.',
        channel: 'qa_handoff',
        timestamp: new Date(now - 20000).toISOString(),
      },
    ];
  }
}

module.exports = {
  OrchestrationRules,
};
