/**
 * server/orchestrationRules.js
 * 
 * OrchestrationRules Engine
 * 
 * Centralizes multi-agent team role resolution, 4-phase sprint decomposition,
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
   * Deconstructs a high-level user goal into 4 sequenced engineering tasks
   * (Architecture Spike -> Feature Implementation -> Code Review -> QA Verification)
   */
  static decomposeSprintGoal(goal, agentsMapOrList, options = {}) {
    const cleanGoal = (goal || '').trim();
    if (!cleanGoal) return [];

    const { pm, lead, dev, tester, platformBadge } = this.resolveTeamRoles(agentsMapOrList);
    const timestamp = Date.now();
    const batchId = Math.random().toString(36).substring(2, 5).toUpperCase();

    const now = new Date().toISOString();
    return [
      {
        id: `TASK-${timestamp}-1`,
        key: `${platformBadge}-${batchId}1`,
        title: `Architecture Spike: ${cleanGoal}`,
        description: `Map impacted files, audit boundary contracts, formulate Clean Architecture interfaces, and write technical execution plan.`,
        assignedTo: lead.id,
        delegatedBy: pm.id,
        delegatedByRole: pm.role || pm.name,
        column: 'in_progress',
        skill: 'task-decomposition',
        progress: 35,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: `TASK-${timestamp}-2`,
        key: `${platformBadge}-${batchId}2`,
        title: `Core Feature Implementation: ${cleanGoal}`,
        description: `Build domain models, repositories, reactive state flows, and UI composables/components adhering to architecture spike.`,
        assignedTo: dev.id,
        delegatedBy: lead.id,
        delegatedByRole: lead.role || lead.name,
        column: 'assigned',
        skill: 'feature-implementation',
        progress: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: `TASK-${timestamp}-3`,
        key: `${platformBadge}-${batchId}3`,
        title: `Quality Gate & Code Review: ${cleanGoal}`,
        description: `10-Point architectural quality review, verify immutability, audit zero memory leaks, and inspect Definition of Done.`,
        assignedTo: lead.id,
        delegatedBy: dev.id,
        delegatedByRole: dev.role || dev.name,
        column: 'backlog',
        skill: 'code-review',
        progress: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: `TASK-${timestamp}-4`,
        key: `${platformBadge}-${batchId}4`,
        title: `Automated QA & Acceptance Verification: ${cleanGoal}`,
        description: `Author and execute automated test suites (unit + integration + regression) to certify 100% green pass rate and acceptance criteria.`,
        assignedTo: tester.id,
        delegatedBy: lead.id,
        delegatedByRole: lead.role || lead.name,
        column: 'backlog',
        skill: 'automated-testing',
        progress: 0,
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
        title: 'Sprint Demo Acceptance & Delivery Sign-Off',
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
        taskTitle: 'Sprint Demo & Acceptance Criteria Sign-Off',
        message: 'Automated test suite completed: 18 / 18 Acceptance Criteria tests passed green with 0 regressions. Sprint deliverable certified against DoD and ready for Sprint Demo sign-off.',
        channel: 'qa_handoff',
        timestamp: new Date(now - 20000).toISOString(),
      },
    ];
  }
}

module.exports = {
  OrchestrationRules,
};
