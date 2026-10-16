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

          // Deliverable 1: PM emits PRD to Tech Lead
          eventBus.recordDeliverable({
            id: 'deliv-prd-101',
            title: 'PRD-101: User Authentication & Token Vault Specification',
            type: 'prd',
            role: pmAgent.role,
            roleSlug: 'pm',
            agentId: pmId,
            agentName: pmName,
            status: 'approved',
            summary: `Sprint 42 feature specification authored by ${pmName}: Scope, user journeys, 6 acceptance criteria, and DoD.`,
            content: `# Product Requirement Document (PRD)
## Feature: User Authentication & Token Vault (US-101)
**Author**: ${pmName} (${pmAgent.role})
**Delivered To**: ${leadName} (${leadAgent.role})
**Sprint**: Sprint 42
**Status**: Approved & Ready for Architecture

### 1. Objective & User Need
Deliver robust authentication with zero security regressions. Users authenticate with cryptographic token rotation and hardware-backed keychain storage.

### 2. User Stories & Acceptance Criteria
- **US-101.1**: Authenticate user credentials and return signed JWT with RS256 token.
- **US-101.2**: Access tokens expire in 15 minutes; auto-refresh rotates without logout.
- **US-101.3**: Failed attempts trigger exponential backoff after 5 attempts.
- **US-101.4**: Token payload signed with RS256 with key rotation support.
- **US-101.5**: Full audit telemetry emitted for compliance monitoring.
- **US-101.6**: Definition of Done: 100% unit tests pass, zero lint warnings.

### 3. Handover Contract
Handed off to Technical Lead (${leadName}) for component boundary contracts and architecture spike.`,
            format: 'markdown',
            filePath: '.agents/sprints/sprint-42/PRD-101.md',
            version: 'v1.0',
            sprintId: 'sprint-42',
            deliveredTo: leadId,
            deliveredToName: leadName,
            deliveredToRole: leadAgent.role,
            metadata: {
              wordCount: 285,
              acceptanceCriteriaCount: 6,
              targetPlatform: isAndroid ? 'Android' : isIos ? 'iOS' : 'Web/Node',
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

          // Deliverable 2: Tech Lead emits Technical Implementation Plan & Architecture
          eventBus.recordDeliverable({
            id: 'deliv-arch-101',
            title: 'ARCH-101: Authentication Architecture & Token Security Specification',
            type: 'architecture',
            role: leadAgent.role,
            roleSlug: 'tech-lead',
            agentId: leadId,
            agentName: leadName,
            status: 'delivered',
            summary: `Technical implementation plan by ${leadName}: Component tree, token lifecycle contracts, and security gates.`,
            content: `# Architecture Contract & Technical Implementation Plan
## Story: US-101 User Authentication Service (ARCH-101)
**Author**: ${leadName} (${leadAgent.role})
**Delivered To**: ${devName} (${devAgent.role})
**Sprint**: Sprint 42
**Status**: Handed off for Implementation

### 1. Component Architecture & Contracts
- **AuthService**: Handles credentials, session generation, and token expiration verification.
- **TokenVault**: Encrypted in-memory store backed by OS hardware keychain.
- **AuthInterceptor**: Injects Bearer tokens and captures 401 unauthenticated signals to trigger refresh.

### 2. Implementation Rules & Constraints
- Immutable state transfer objects (\`UserSession\`, \`AuthToken\`).
- Zero implicit any types; strict compile targets.
- 100% test branch coverage on credential verification and refresh lock concurrency.

### 3. Deliverable Acceptance Criteria
- Verified against PRD-101 Definition of Done before opening pull request.`,
            format: 'markdown',
            filePath: '.agents/sprints/sprint-42/ARCH-101.md',
            version: 'v1.0',
            sprintId: 'sprint-42',
            deliveredTo: devId,
            deliveredToName: devName,
            deliveredToRole: devAgent.role,
            metadata: {
              wordCount: 220,
              securityChecksPassed: 8,
              targetPlatform: isAndroid ? 'Android' : isIos ? 'iOS' : 'TypeScript/Node',
            },
          });
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

          // Deliverable 3: Dev emits Source Code Deliverable
          eventBus.recordDeliverable({
            id: 'deliv-code-101',
            title: `CODE-101: AuthService & Token Interceptor Implementation (${devFileName})`,
            type: 'source_code',
            role: devAgent.role,
            roleSlug: 'dev',
            agentId: devId,
            agentName: devName,
            status: 'in_review',
            summary: `Core authentication service with token encryption, session persistence, and initial unit tests in ${devFileName}.`,
            content: `/**
 * AuthService Implementation (CODE-101)
 * Author: ${devName} (${devAgent.role})
 * Delivered To: ${leadName} (${leadAgent.role})
 * Platform: ${isAndroid ? 'Android Kotlin' : isIos ? 'iOS Swift' : 'TypeScript/Node'}
 */
${isAndroid
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
}`}`,
            format: 'code',
            filePath: devFile,
            version: 'v1.0',
            sprintId: 'sprint-42',
            deliveredTo: leadId,
            deliveredToName: leadName,
            deliveredToRole: leadAgent.role,
            metadata: {
              linesOfCode: 56,
              coveragePercent: 92,
              targetPlatform: isAndroid ? 'Android' : isIos ? 'iOS' : 'Web/TypeScript',
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

          // Deliverable 4: Tech Lead emits Code Review & Quality Gate Report
          eventBus.recordDeliverable({
            id: 'deliv-rev-101',
            title: 'REV-101: Architectural Quality Gate & Security Review Report',
            type: 'code_review',
            role: leadAgent.role,
            roleSlug: 'tech-lead',
            agentId: leadId,
            agentName: leadName,
            status: 'approved',
            summary: `Code review and Definition of Done verification by ${leadName}: Zero memory leaks, verified token expiration, approved for QA merge.`,
            content: `# Senior Architectural Review & Definition of Done Sign-Off
## Feature: PR #101 User Authentication Service (REV-101)
**Reviewer**: ${leadName} (${leadAgent.role})
**Author**: ${devName} (${devAgent.role})
**Sprint**: Sprint 42
**Status**: APPROVED & MERGED

### 1. Verification Checklist (10-Point Quality Gate)
- [x] Immutability enforced on all session DTOs.
- [x] Token expiration timestamps checked prior to state restoration.
- [x] Edge-case unit tests added for malformed signatures and expired sessions.
- [x] Concurrency mutex prevents stampeding refresh calls.
- [x] Zero compiler errors or linter warnings.
- [x] All 100% unit tests execute and pass green.

### 2. Tech Lead Verdict
PR #101 satisfies the Definition of Done. Approved and dispatched to QA for automated regression testing.`,
            format: 'markdown',
            filePath: '.agents/sprints/sprint-42/REV-101-CODE-REVIEW.md',
            version: 'v1.0',
            sprintId: 'sprint-42',
            deliveredTo: testerId,
            deliveredToName: testerName,
            deliveredToRole: testerAgent.role,
            metadata: {
              wordCount: 195,
              securityChecksPassed: 10,
              targetPlatform: isAndroid ? 'Android' : isIos ? 'iOS' : 'Web/Node',
            },
          });
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

          // Deliverable 5: QA emits Automated Test Report & Verification
          eventBus.recordDeliverable({
            id: 'deliv-qa-101',
            title: 'QA-101: E2E Authentication Test Suite & Regression Report',
            type: 'test_report',
            role: testerAgent.role,
            roleSlug: 'qa',
            agentId: testerId,
            agentName: testerName,
            status: 'approved',
            summary: `Automated test execution by ${testerName}: 18/18 Acceptance Criteria tests passed with zero regressions via ${testCmd}.`,
            content: `# Automated E2E Test Suite & Regression Report
## Sprint 42 Verification: Feature US-101 Authentication
**Author**: ${testerName} (${testerAgent.role})
**Delivered To**: ${pmName} (${pmAgent.role})
**Status**: 100% PASS RATE (Certified for Release)

### 1. Test Execution Metrics
- **Command**: \`${testCmd}\`
- **Total Tests Executed**: 18
- **Passed**: 18 (100%)
- **Failed**: 0 (0%)
- **Regression Defects**: 0
- **Code Coverage**: 98.4%

### 2. Verified Acceptance Criteria
- [x] US-101.1: OAuth2 and password credential exchange.
- [x] US-101.2: 15-minute token expiry with auto-refresh rotation.
- [x] US-101.3: Rate limiting exponential backoff on 5 failures.
- [x] US-101.4: Hardware-backed keychain persistence.
- [x] US-101.5: Security audit telemetry emitted.
- [x] US-101.6: Zero P0/P1 security vulnerabilities.

### 3. QA Recommendation
Ready for immediate production release sign-off by Product Manager.`,
            format: 'markdown',
            filePath: '.agents/sprints/sprint-42/QA-TEST-REPORT-101.md',
            version: 'v1.0',
            sprintId: 'sprint-42',
            deliveredTo: pmId,
            deliveredToName: pmName,
            deliveredToRole: pmAgent.role,
            metadata: {
              testCount: 18,
              testPassRate: '100%',
              coveragePercent: 98.4,
              targetPlatform: isAndroid ? 'Android' : isIos ? 'iOS' : 'Web/Node',
            },
          });
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

          // Deliverable 6: PM emits Release Sign-Off
          eventBus.recordDeliverable({
            id: 'deliv-rel-101',
            title: 'REL-101: Sprint 42 Production Release Sign-Off & DoD Checklist',
            type: 'release_signoff',
            role: pmAgent.role,
            roleSlug: 'pm',
            agentId: pmId,
            agentName: pmName,
            status: 'approved',
            summary: `Final Sprint 42 delivery certification signed by ${pmName}: 100% acceptance criteria verified, QA certified, ready to deploy.`,
            content: `# Production Release Sign-Off & Sprint Delivery Certificate
## Feature: User Authentication & Token Vault (REL-101)
**Sign-Off Authority**: ${pmName} (${pmAgent.role})
**Sprint**: Sprint 42
**Status**: OFFICIALLY SIGNED OFF & SHIPPED

### 1. Sprint Accomplishments
All user stories for authentication, encrypted token lifecycle, and session verification have been delivered and verified across all roles:
- **Product Management**: PRD-101 Definition of Done satisfied.
- **Tech Leadership**: Architecture contract ARCH-101 implemented and REV-101 quality gate passed.
- **Core Engineering**: Code deliverable CODE-101 merged with zero regression defects.
- **QA & Testing**: QA-101 automated test suite passed at 100% rate.

### 2. Stakeholder Release Authorization
The release candidate meets all enterprise security, audit, and quality thresholds. Authorized for production rollout.`,
            format: 'markdown',
            filePath: '.agents/sprints/sprint-42/RELEASE-SIGNOFF-101.md',
            version: 'v1.0',
            sprintId: 'sprint-42',
            metadata: {
              wordCount: 175,
              acceptanceCriteriaCount: 6,
              targetPlatform: isAndroid ? 'Android' : isIos ? 'iOS' : 'Web/Node',
            },
          });

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

      // Reset board tasks, analytics & workflow back to clean Standby
      eventBus.tasks = new Map();
      eventBus.fileChanges = [];
      eventBus.communications = [];
      eventBus.toolUsageMap = new Map();
      eventBus.skillUsageMap = new Map();
      eventBus.initStandbyRoleAnalytics();
      eventBus.workflowTitle = `${eventBus.projectName || 'Virtual Office'} • Standby`;
      eventBus.currentPhase = 'Standby & Ready';
      eventBus.latestMilestone = `👉 Standby on ${eventBus.projectName || 'workspace'}: Ready for AI agent tasks.`;
      eventBus.latestMilestoneAgentId = eventBus.agents.size > 0 ? eventBus.agents.keys().next().value : 'project-manager';
    }

    eventBus.events = [];
    eventBus.deliverables = new Map();
    eventBus.jiraConfluenceItems = [];
    // Bring the real sprint's tasks back onto the board
    if (typeof eventBus.resyncRealTasks === 'function') {
      eventBus.resyncRealTasks();
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
