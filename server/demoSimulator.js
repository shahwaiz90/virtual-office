const { eventBus } = require('./eventBus');
const { OrchestrationRules } = require('./orchestrationRules');
const { generateGhostAgents } = require('./agentDiscovery');

class DemoSimulator {
  constructor() {
    this.timer = null;
    this.isRunning = false;
    this.isGhostTeam = false;
    this.stepIndex = 0;
    this.timeouts = [];
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    eventBus.isDemoRunning = true;
    eventBus.fileChanges = [];
    eventBus.communications = [];
    this.stepIndex = 0;

    // Check if eventBus.agents.size === 0 (empty workspace with no configured agents)
    if (eventBus.agents.size === 0) {
      this.isGhostTeam = true;
      eventBus.isGhostTeam = true;
      const ghostAgents = generateGhostAgents();
      for (const a of ghostAgents) {
        eventBus.agents.set(a.id, a);
      }
    } else {
      this.isGhostTeam = false;
      eventBus.isGhostTeam = false;
    }

    // Reset workflow and load clean initial demo tasks
    eventBus.resetWorkflow('SCRUM SPRINT-42: User Authentication Story (Definition of Done)');

    // Dynamically resolve team roles strictly via OrchestrationRules
    const { pm: pmAgent, lead: leadAgent, dev: devAgent, tester: testerAgent, platformBadge } = OrchestrationRules.resolveTeamRoles(eventBus.agents);

    const pmId = pmAgent.id;
    const leadId = leadAgent.id;
    const devId = devAgent.id;
    const testerId = testerAgent.id;

    const pmName = pmAgent.name || "Project Lead";
    const leadName = leadAgent.name || "Technical Lead";
    const devName = devAgent.name || "Core Developer";
    const testerName = testerAgent.name || "QA Specialist";

    const isAndroid = platformBadge === "AND";
    const isIos = platformBadge === "IOS";

    const devFile = isAndroid ? 'app/src/main/java/com/app/auth/AuthRepository.kt' : isIos ? 'App/Sources/AuthService.swift' : 'src/services/auth-service.ts';
    const devFileName = isAndroid ? 'AuthRepository.kt' : isIos ? 'AuthService.swift' : 'auth-service.ts';
    const testFile = isAndroid ? 'app/src/test/java/com/app/auth/AuthRepositoryTest.kt' : isIos ? 'App/Tests/AuthServiceTests.swift' : 'tests/auth-service.test.ts';
    const testFileName = isAndroid ? 'AuthRepositoryTest.kt' : isIos ? 'AuthServiceTests.swift' : 'auth-service.test.ts';
    const buildCmd = isAndroid ? './gradlew assembleDebug' : isIos ? 'xcodebuild -scheme App build' : 'npm run build';
    const testCmd = isAndroid ? './gradlew testDebugUnitTest' : isIos ? 'xcodebuild test -scheme App' : 'npm test';

    // Broadcast demo active state immediately
    eventBus.broadcast({
      type: 'DEMO_STATE',
      isDemo: true,
      state: eventBus.getStateSnapshot(),
    });

    console.log(`[DemoSimulator] Starting realistic Scrum sprint simulation with configured agents: ${pmName}, ${leadName}, ${devName}, ${testerName}...`);

    // Announce demo simulation mode
    eventBus.emitEvent({
      agentId: pmId,
      type: 'milestone_update',
      payload: {
        phase: 'Sprint Planning',
        milestone: '🏉 DEMO AGENTIC WORKFLOW STARTED: PM ingesting User Story US-101 into Sprint Backlog.',
        details: 'Scrum Pipeline: PM -> Tech Lead (Architecture) -> Developer (Implementation) -> Tech Lead (Review & Feedback Loop) -> Developer (Patch & Resubmit) -> Tech Lead (Approved) -> QA (Acceptance Testing) -> PM (Sign-Off).',
      },
    });

    const steps = [
      // =========================================================================
      // 1. SPRINT PLANNING & TICKET INTAKE (PM / Scrum Master)
      // =========================================================================
      {
        delay: 1200,
        run: () => {
          eventBus.emitEvent({
            agentId: pmId,
            type: 'tool_executing',
            payload: {
              task: 'Sprint Backlog Ingestion (US-101)',
              tool: 'sprint_planner',
              command: 'scrum plan --sprint 42 --story "US-101" --definition-of-done',
              details: `${pmName} facilitated Sprint Planning, ingested Story US-101 (User Authentication), and verified Definition of Ready (DoR)`,
              taskId: 'TASK-1',
              column: 'in_progress',
              progress: 60,
              phase: 'Sprint Planning',
            },
          });
        },
      },

      // =========================================================================
      // 2. HANDOFF 1: PM -> TECH LEAD (Architecture Spike & Boundary Contracts)
      // =========================================================================
      {
        delay: 4200,
        run: () => {
          // Complete Task 1
          const t1 = eventBus.tasks.get('TASK-1');
          if (t1) { t1.column = 'done'; t1.progress = 100; }

          eventBus.emitEvent({
            agentId: pmId,
            type: 'agent_handoff',
            payload: {
              fromAgent: pmId,
              toAgent: leadId,
              task: 'Technical Architecture Spike & Boundary Design',
              allowedSkill: 'architecture-planning',
              taskId: 'TASK-2',
              key: `${leadAgent?.badge || 'LEAD'}-101`,
              column: 'in_progress',
              progress: 30,
              phase: 'Architecture Spike',
              channel: 'sprint_planning',
              details: `${pmName} handed over sprint backlog item US-101 to ${leadName}: "Sprint 42 Story US-101 is ready for architecture design. Please map domain contracts, token lifecycle, and unit test specifications."`,
              milestone: `${pmName} handed off US-101 to ${leadName} for technical architecture design.`,
            },
          });
        },
      },

      // =========================================================================
      // 3. TECH LEAD: ARCHITECTURE SPIKE & BOUNDARY SPECIFICATIONS
      // =========================================================================
      {
        delay: 7800,
        run: () => {
          eventBus.emitEvent({
            agentId: leadId,
            type: 'file_modified',
            payload: {
              task: 'Architecture Plan Persisted',
              tool: 'write_to_file',
              file: 'scratch/task/FEATURE-101/lead/architecture-plan.md',
              fileName: 'architecture-plan.md',
              action: 'created',
              linesAdded: 18,
              contentPreview: `### Architecture Boundary Contract: Authentication Service
1. **Presentation Layer**: StateFlow ViewModel bindings with immutable UI state.
2. **Domain Boundary**: Strict immutability on \`UserSession\` and \`AuthToken\` DTOs.
3. **Data Layer**: Clean repository interface with secure token signing & persistent storage.
4. **Quality Gate**: 100% test coverage required on happy path, invalid credentials, and token expiration.`,
              details: `${leadName} locked architecture boundaries, service contracts, and unit test specifications in architecture-plan.md`,
              taskId: 'TASK-2',
              column: 'done',
              progress: 100,
              phase: 'Architecture Locked',
              milestone: `${leadName} completed architecture plan and locked component contracts for development.`,
            },
          });
          const t2 = eventBus.tasks.get('TASK-2');
          if (t2) { t2.column = 'done'; t2.progress = 100; }
        },
      },

      // =========================================================================
      // 4. HANDOFF 2: TECH LEAD -> DEVELOPER (Implementation & Unit Tests)
      // =========================================================================
      {
        delay: 11000,
        run: () => {
          eventBus.emitEvent({
            agentId: leadId,
            type: 'agent_handoff',
            payload: {
              fromAgent: leadId,
              toAgent: devId,
              task: 'Core Implementation & AAA Unit Tests',
              allowedSkill: 'feature-implementation',
              taskId: 'TASK-3',
              key: `${devAgent?.badge || 'DEV'}-101`,
              column: 'in_progress',
              progress: 30,
              phase: 'Implementation',
              channel: 'subagent_delegation',
              details: `${leadName} delegated implementation to ${devName}: "Architecture contracts locked. Implement AuthService with token verification and author comprehensive AAA unit tests according to the spec."`,
              milestone: `${leadName} handed component contracts and test specs to ${devName}.`,
            },
          });
        },
      },

      // =========================================================================
      // 5. DEVELOPER: CODING INITIAL IMPLEMENTATION
      // =========================================================================
      {
        delay: 14500,
        run: () => {
          eventBus.emitEvent({
            agentId: devId,
            type: 'file_modified',
            payload: {
              task: 'Coding Authentication Service',
              tool: 'replace_file_content',
              file: devFile,
              fileName: devFileName,
              action: 'modified',
              linesAdded: 24,
              contentPreview: isAndroid
                ? `class AuthRepository(private val authApi: AuthApi, private val sessionDao: SessionDao) {
  val sessionState: StateFlow<UserSession?> = sessionDao.observeSession()

  suspend fun authenticate(credentials: AuthCredentials): Result<UserSession> {
    val response = authApi.login(credentials)
    sessionDao.saveSession(response.session)
    return Result.success(response.session)
  }
}`
                : isIos
                ? `actor AuthService: ObservableObject {
  @Published private(set) var currentSession: UserSession?

  func authenticate(credentials: AuthCredentials) async throws -> UserSession {
    let session = try await apiClient.login(credentials)
    self.currentSession = session
    return session
  }
}`
                : `export class AuthService {
  private readonly sessionStore = new Map<string, UserSession>();

  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    const user = await this.userRepository.findByEmail(credentials.email);
    if (!user || !verifyPassword(credentials.password, user.passwordHash)) {
      throw new AuthenticationError('Invalid email or password');
    }
    const token = signJwt({ sub: user.id, email: user.email }, { expiresIn: '8h' });
    this.sessionStore.set(user.id, { token, lastActive: Date.now() });
    return { token, user: Object.freeze(user) };
  }
}`,
              instruction: 'Implement token verification and session persistence with strict immutability',
              details: `${devName} implemented token verification and session persistence in ${devFileName}`,
              taskId: 'TASK-3',
              column: 'in_progress',
              progress: 55,
              phase: 'Implementation',
              milestone: `${devName} implemented AuthService token logic in ${devFileName}.`,
            },
          });
        },
      },

      // =========================================================================
      // 6. DEVELOPER: AUTHORING UNIT TESTS & COMPILING BUILD
      // =========================================================================
      {
        delay: 17800,
        run: () => {
          eventBus.emitEvent({
            agentId: devId,
            type: 'file_modified',
            payload: {
              task: 'Authoring AAA Unit Tests',
              tool: 'write_to_file',
              file: testFile,
              fileName: testFileName,
              action: 'created',
              linesAdded: 18,
              contentPreview: isAndroid
                ? `class AuthRepositoryTest {
  @Test
  fun authenticate_validCredentials_emitsSessionState() = runTest {
    val repo = AuthRepository(mockApi, mockDao)
    val result = repo.authenticate(validCreds)
    assertTrue(result.isSuccess)
  }
}`
                : isIos
                ? `final class AuthServiceTests: XCTestCase {
  func testAuthenticate_validCredentials_setsCurrentSession() async throws {
    let service = AuthService(api: mockApi)
    let session = try await service.authenticate(credentials: validCreds)
    XCTAssertNotNil(session)
  }
}`
                : `describe('AuthService AAA Test Suite', () => {
  it('authenticates valid credentials and generates immutable session', async () => {
    const authService = new AuthService(mockRepo);
    const result = await authService.authenticate({ email: 'test@company.com', password: 'SecretPassword123' });
    expect(result.token).toBeDefined();
  });
});`,
              instruction: 'Authored AAA unit test scenarios for valid and invalid credentials',
              details: `${devName} authored initial AAA unit test scenarios in ${testFileName}`,
              taskId: 'TASK-3',
              column: 'in_progress',
              progress: 75,
              phase: 'Implementation',
              milestone: `${devName} authored initial unit tests in ${testFileName} and compiled with ${buildCmd}.`,
            },
          });
        },
      },

      // =========================================================================
      // 7. HANDOFF 3: DEVELOPER -> TECH LEAD (PR Submitted for Senior Review)
      // =========================================================================
      {
        delay: 21000,
        run: () => {
          eventBus.emitEvent({
            agentId: devId,
            type: 'agent_handoff',
            payload: {
              fromAgent: devId,
              toAgent: leadId,
              task: 'Pull Request #101 Review & Definition of Done',
              allowedSkill: 'code-review',
              taskId: 'TASK-3',
              key: `${devAgent?.badge || 'DEV'}-101`,
              column: 'review',
              progress: 80,
              phase: 'Sprint Code Review',
              channel: 'pr_review',
              details: `${devName} submitted PR #101 to ${leadName}: "PR #101 submitted for code review. Implemented AuthService with token creation and initial unit tests. Ready for senior review against DoD."`,
              milestone: `${devName} submitted PR #101 to ${leadName} for code review.`,
            },
          });
        },
      },

      // =========================================================================
      // 8. TECH LEAD: CODE REVIEW AUDIT (FINDING FEEDBACK / CHANGES REQUESTED)
      // =========================================================================
      {
        delay: 24200,
        run: () => {
          eventBus.emitEvent({
            agentId: leadId,
            type: 'tool_executing',
            payload: {
              task: 'Senior Code Review & Static Analysis Audit',
              tool: 'git diff',
              command: `git diff origin/main...feature/auth-service`,
              details: `${leadName} conducted senior code review on PR #101: Code structure is clean, but token expiration timestamp is not validated on session restore, and edge case for malformed token lacks a test.`,
              taskId: 'TASK-3',
              column: 'review',
              progress: 85,
              phase: 'Sprint Code Review',
              milestone: `${leadName} audited PR #101: Identified missing token expiration check & edge-case test.`,
            },
          });
        },
      },

      // =========================================================================
      // 9. HANDOFF 4: TECH LEAD -> DEVELOPER (FEEDBACK LOOP: CHANGES REQUESTED)
      // =========================================================================
      {
        delay: 27200,
        run: () => {
          eventBus.emitEvent({
            agentId: leadId,
            type: 'agent_handoff',
            payload: {
              fromAgent: leadId,
              toAgent: devId,
              task: 'PR #101 Changes Requested: Token Expiry & Edge Cases',
              allowedSkill: 'feature-implementation',
              taskId: 'TASK-3',
              key: `${devAgent?.badge || 'DEV'}-101`,
              column: 'in_progress',
              progress: 65,
              phase: 'Feedback Loop (Refactoring)',
              channel: 'pr_review',
              details: `${leadName} requested changes on PR #101 from ${devName}: "Changes requested on PR #101: Token expiration timestamp is not validated during session deserialization, and edge case for malformed token signature lacks test coverage. Please patch and update test suite."`,
              milestone: `⚠️ Feedback Loop: ${leadName} requested changes on PR #101 from ${devName}.`,
            },
          });
        },
      },

      // =========================================================================
      // 10. DEVELOPER: ADDRESSING FEEDBACK, PATCHING EXPIRY & ADDING TESTS
      // =========================================================================
      {
        delay: 30800,
        run: () => {
          eventBus.emitEvent({
            agentId: devId,
            type: 'file_modified',
            payload: {
              task: 'Patching Token Expiry & Edge Case Tests',
              tool: 'replace_file_content',
              file: devFile,
              fileName: devFileName,
              action: 'modified',
              linesAdded: 16,
              contentPreview: isAndroid
                ? `fun validateSession(session: UserSession): Boolean {
    if (System.currentTimeMillis() > session.expiresAt) {
      throw TokenExpiredException("Session token has expired")
    }
    return tokenValidator.verify(session.token)
}`
                : isIos
                ? `func validateSession(_ session: UserSession) throws -> Bool {
    guard Date().timeIntervalSince1970 < session.expiresAt else {
      throw AuthError.tokenExpired
    }
    return try tokenValidator.verify(session.token)
}`
                : `validateSession(session: UserSession): boolean {
    if (Date.now() > session.expiresAt) {
      throw new TokenExpiredError('Session token has expired');
    }
    return this.tokenValidator.verify(session.token);
}`,
              instruction: 'Patch token expiration verification and add edge-case unit test coverage',
              details: `${devName} patched token expiration validation and added edge-case test in ${testFileName}`,
              taskId: 'TASK-3',
              column: 'in_progress',
              progress: 90,
              phase: 'Feedback Addressed',
              milestone: `${devName} addressed review feedback: patched token expiration and added edge tests.`,
            },
          });
        },
      },

      // =========================================================================
      // 11. HANDOFF 5: DEVELOPER -> TECH LEAD (PR RESUBMISSION: FEEDBACK RESOLVED)
      // =========================================================================
      {
        delay: 34200,
        run: () => {
          eventBus.emitEvent({
            agentId: devId,
            type: 'agent_handoff',
            payload: {
              fromAgent: devId,
              toAgent: leadId,
              task: 'PR #101 Resubmission: Feedback Addressed & DoD Ready',
              allowedSkill: 'code-review',
              taskId: 'TASK-3',
              key: `${devAgent?.badge || 'DEV'}-101`,
              column: 'review',
              progress: 95,
              phase: 'Sprint Code Review',
              channel: 'pr_review',
              details: `${devName} resubmitted PR #101 to ${leadName}: "Feedback addressed on PR #101: Token expiration validation added and edge-case unit tests authored. All tests passing green. Ready for final DoD sign-off."`,
              milestone: `${devName} resubmitted PR #101 to ${leadName} with all review feedback resolved.`,
            },
          });
        },
      },

      // =========================================================================
      // 12. TECH LEAD: DEFINITION OF DONE VERIFIED & PR APPROVED
      // =========================================================================
      {
        delay: 37500,
        run: () => {
          eventBus.emitEvent({
            agentId: leadId,
            type: 'tool_executing',
            payload: {
              task: 'Definition of Done (DoD) Quality Audit',
              tool: 'code-review',
              details: `${leadName} approved PR #101: Zero mutable state leaks, token expiration enforced, and 100% unit tests verified against Definition of Done.`,
              taskId: 'TASK-3',
              column: 'done',
              progress: 100,
              phase: 'Review Approved (DoD Passed)',
              milestone: `🎉 ${leadName} approved PR #101: Definition of Done fully satisfied and code merged.`,
            },
          });
          const t3 = eventBus.tasks.get('TASK-3');
          if (t3) { t3.column = 'done'; t3.progress = 100; }
        },
      },

      // =========================================================================
      // 13. HANDOFF 6: TECH LEAD -> QA SPECIALIST (FINALLY TO QA!)
      // =========================================================================
      {
        delay: 40500,
        run: () => {
          eventBus.emitEvent({
            agentId: leadId,
            type: 'agent_handoff',
            payload: {
              fromAgent: leadId,
              toAgent: testerId,
              task: 'Automated Regression & Acceptance Criteria Verification',
              allowedSkill: 'automated-testing',
              taskId: 'TASK-4',
              key: `${testerAgent?.badge || 'QA'}-101`,
              column: 'testing',
              progress: 60,
              phase: 'Sprint Acceptance Testing',
              channel: 'qa_handoff',
              details: `${leadName} handed approved deliverable to ${testerName}: "PR #101 approved and merged. Dispatched to QA for automated regression suite and Acceptance Criteria sign-off."`,
              milestone: `${leadName} handed over approved build to ${testerName} for QA acceptance verification.`,
            },
          });
        },
      },

      // =========================================================================
      // 14. QA SPECIALIST: AUTOMATED REGRESSION RUN & VERIFICATION
      // =========================================================================
      {
        delay: 44000,
        run: () => {
          eventBus.emitEvent({
            agentId: testerId,
            type: 'test_result',
            payload: {
              task: 'Acceptance Criteria Verified',
              tool: 'run_command',
              command: testCmd,
              testsPassed: 18,
              testsFailed: 0,
              taskId: 'TASK-4',
              column: 'done',
              progress: 100,
              file: 'scratch/task/FEATURE-101/tester/test-results.md',
              details: `18 / 18 Acceptance Criteria tests passed cleanly with zero regressions via ${testCmd}`,
              milestone: '🎉 All 18 Acceptance Criteria tests passed green. Zero regressions found.',
            },
          });
          const t4 = eventBus.tasks.get('TASK-4');
          if (t4) { t4.column = 'done'; t4.progress = 100; }
        },
      },

      // =========================================================================
      // 15. HANDOFF 7: QA SPECIALIST -> PM (QA TO PM!)
      // =========================================================================
      {
        delay: 47200,
        run: () => {
          eventBus.emitEvent({
            agentId: testerId,
            type: 'agent_handoff',
            payload: {
              fromAgent: testerId,
              toAgent: pmId,
              task: 'Demo Agentic Workflow Acceptance & Delivery Sign-Off',
              allowedSkill: 'pm-reporting',
              taskId: 'TASK-5',
              key: 'REL-101',
              column: 'in_progress',
              progress: 80,
              phase: 'Demo Agentic Workflow & Review',
              channel: 'qa_handoff',
              details: `${testerName} handed over certified test report to ${pmName}: "Automated regression suite verified: 18 / 18 Acceptance Criteria tests passed cleanly with 0 regressions. Sprint deliverable certified against DoD and ready for Demo Agentic Workflow sign-off."`,
              milestone: `${testerName} certified acceptance criteria and handed over to ${pmName} for Demo Agentic Workflow sign-off.`,
            },
          });
        },
      },

      // =========================================================================
      // 16. PM: SPRINT GOAL CERTIFIED & FEATURE DELIVERED
      // =========================================================================
      {
        delay: 50500,
        run: () => {
          eventBus.emitEvent({
            agentId: pmId,
            type: 'task_completed',
            payload: {
              task: 'Sprint Goal Acceptance & DoD Certified',
              tool: 'write_to_file',
              file: 'scratch/task/FEATURE-101/pm/sprint-demo-report.md',
              taskId: 'TASK-5',
              column: 'done',
              progress: 100,
              phase: 'Sprint Goal Delivered',
              milestone: '🎉 SPRINT GOAL ACHIEVED: US-101 User Authentication delivered according to Definition of Done.',
              details: `${pmName} certified Definition of Done, completed Sprint Review, and signed off Sprint Goal delivery: "Sprint Goal achieved! Feature US-101 certified and delivered to stakeholder. Outstanding job team!"`,
            },
          });
          const t5 = eventBus.tasks.get('TASK-5');
          if (t5) { t5.column = 'done'; t5.progress = 100; }

          // Complete scenario: reset demo flags so UI updates from "Stop Demo" back to "Demo Agentic Workflow"
          this.isRunning = false;
          eventBus.isDemoRunning = false;
          if (eventBus.clearHandoff) {
            eventBus.clearHandoff();
          } else {
            eventBus.activeHandoff = null;
          }

          if (this.isGhostTeam || eventBus.isGhostTeam) {
            eventBus.agents.clear();
            this.isGhostTeam = false;
            eventBus.isGhostTeam = false;
            eventBus.tasks = new Map();
            eventBus.fileChanges = [];
            eventBus.communications = [];
            eventBus.roleInvocationMap = new Map();
            eventBus.toolUsageMap = new Map();
            eventBus.skillUsageMap = new Map();
            eventBus.workflowTitle = `${eventBus.projectName || 'Virtual Office'} • Standby`;
            eventBus.currentPhase = 'Standby & Ready';
            eventBus.latestMilestoneAgentId = null;
            eventBus.latestMilestone = `⚠️ No agents found in ${eventBus.projectName || 'workspace'}. Click "Setup Team" to create your roles & agents.`;
          }

          eventBus.broadcast({
            type: 'DEMO_STATE',
            isDemo: false,
            state: eventBus.getStateSnapshot(),
          });
          eventBus.broadcast({
            type: 'STATE_UPDATE',
            state: eventBus.getStateSnapshot(),
          });
          eventBus.broadcast({
            type: 'SYNC_STATE',
            data: eventBus.getStateSnapshot(),
          });
          console.log('[DemoSimulator] Demonstration scenario completed successfully. Switched isDemo to false.');
        },
      },
    ];

    // Schedule all steps with cancellation guard
    this.timeouts = steps.map((s) =>
      setTimeout(() => {
        if (!this.isRunning) return;
        s.run();
      }, s.delay)
    );
  }

  stop() {
    this.isRunning = false;
    eventBus.isDemoRunning = false;
    if (this.timeouts) {
      this.timeouts.forEach(clearTimeout);
      this.timeouts = [];
    }
    eventBus.clearAllAgentBusyTimers();
    if (eventBus.clearHandoff) {
      eventBus.clearHandoff();
    } else {
      eventBus.activeHandoff = null;
    }

    if (this.isGhostTeam || eventBus.isGhostTeam) {
      eventBus.agents.clear();
      this.isGhostTeam = false;
      eventBus.isGhostTeam = false;
      eventBus.tasks = new Map();
      eventBus.fileChanges = [];
      eventBus.communications = [];
      eventBus.roleInvocationMap = new Map();
      eventBus.toolUsageMap = new Map();
      eventBus.skillUsageMap = new Map();
      eventBus.workflowTitle = `${eventBus.projectName || 'Virtual Office'} • Standby`;
      eventBus.currentPhase = 'Standby & Ready';
      eventBus.latestMilestoneAgentId = null;
      eventBus.latestMilestone = `⚠️ No agents found in ${eventBus.projectName || 'workspace'}. Click "Setup Team" to create your roles & agents.`;
    } else {
      // Reset all agents to ready standby at their workstations
      for (const [id, agent] of eventBus.agents.entries()) {
        agent.status = 'available';
        agent.currentTask = null;
        agent.currentFile = null;
        agent.activityMessage = 'Ready at workstation';
        agent.taskStartedAt = null;
        agent.taskCompletedAt = null;
        agent.taskDurationSec = null;
        if (agent.theme?.deskPosition) {
          agent.currentPosition = { ...agent.theme.deskPosition };
        }
      }

      // Reset board tasks & workflow back to clean Standby
      eventBus.tasks = new Map();
      eventBus.fileChanges = [];
      eventBus.communications = [];
      eventBus.workflowTitle = `${eventBus.projectName || 'Virtual Office'} • Standby`;
      eventBus.currentPhase = 'Standby & Ready';
      eventBus.latestMilestone = `👉 Standby on ${eventBus.projectName || 'workspace'}: Ready for AI agent tasks.`;
      eventBus.latestMilestoneAgentId = eventBus.agents.size > 0 ? eventBus.agents.keys().next().value : 'project-manager';
    }

    eventBus.broadcast({
      type: 'DEMO_STATE',
      isDemo: false,
      state: eventBus.getStateSnapshot(),
    });
    eventBus.broadcast({
      type: 'SYNC_STATE',
      data: eventBus.getStateSnapshot(),
    });
    console.log('[DemoSimulator] Demonstration scenario stopped and office reset to Standby.');
  }
}

const globalDemoSimulator = new DemoSimulator();

module.exports = {
  DemoSimulator,
  demoSimulator: globalDemoSimulator,
};
