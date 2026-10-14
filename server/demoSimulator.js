const { eventBus } = require('./eventBus');

class DemoSimulator {
  constructor() {
    this.timer = null;
    this.isRunning = false;
    this.stepIndex = 0;
    this.timeouts = [];
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.stepIndex = 0;

    // Dynamically resolve agents or fall back cleanly
    const agentList = Array.from(eventBus.agents.values());
    const findAgent = (query, fallback) => {
      const q = query.toLowerCase();
      const match = agentList.find(
        (a) =>
          (a.id && a.id.toLowerCase().includes(q)) ||
          (a.role && a.role.toLowerCase().includes(q))
      );
      return match ? match.id : fallback;
    };

    const pmId = findAgent('pm') || findAgent('manager') || agentList[0]?.id || 'project-manager';
    const leadId = findAgent('lead') || findAgent('arch') || agentList[1]?.id || 'tech-lead';
    const devId = findAgent('dev') || findAgent('engineer') || agentList[2]?.id || 'developer';
    const testerId = findAgent('test') || findAgent('qa') || agentList[3]?.id || 'tester';

    eventBus.resetWorkflow('DEMO: FEATURE-101 (User Authentication Service)');

    console.log('[DemoSimulator] Starting realistic multi-agent presentation simulation...');

    // Announce demo simulation mode
    eventBus.emitEvent({
      agentId: pmId,
      type: 'milestone_update',
      payload: {
        phase: 'Intake & Triage',
        milestone: '⚠️ SIMULATION DEMO STARTED: Ingesting FEATURE-101 (User Authentication Service).',
        details: 'Simulated multi-agent workflow started for management presentation.',
      },
    });

    const steps = [
      // Step 1: PM analyzes requirement
      {
        delay: 2000,
        run: () => {
          eventBus.emitEvent({
            agentId: pmId,
            type: 'tool_executing',
            payload: {
              task: 'Backlog Auto-Ingestion',
              tool: 'issue_parser',
              command: 'node scripts/ingest_issue.js --id "FEATURE-101" -o scratch/task/FEATURE-101/specs.md',
              details: 'Auto-ingested ticket FEATURE-101 and parsed acceptance criteria',
              taskId: 'TASK-1',
              column: 'in_progress',
            },
          });
        },
      },
      // Step 2: PM minute estimation
      {
        delay: 4000,
        run: () => {
          eventBus.emitEvent({
            agentId: pmId,
            type: 'task_started',
            payload: {
              task: 'Sizing in Minutes',
              tool: 'write_to_file',
              file: 'scratch/task/FEATURE-101/pm/estimation.md',
              details: 'Sized under 10-Minute SLA: Lead: 1.5m, Dev: 4m, QA: 1.5m (Total: 7 mins)',
              taskId: 'TASK-1',
              column: 'done',
              phase: 'Intake Complete',
              milestone: 'Sprint sizing confirmed: 7 minutes total SLA. Autonomous execution authorized.',
            },
          });
        },
      },
      // Step 3: Handoff PM -> Tech Lead
      {
        delay: 6000,
        run: () => {
          eventBus.emitEvent({
            agentId: pmId,
            type: 'agent_handoff',
            payload: {
              fromAgent: pmId,
              toAgent: leadId,
              task: 'Architecture Scoping & Test Specs',
              allowedSkill: 'tech-lead-planning',
              taskId: 'TASK-2',
              column: 'in_progress',
              phase: 'Architecture & Planning',
              details: 'PM delegated architectural boundaries and test specifications to Tech Lead',
            },
          });
        },
      },
      // Step 4: Tech Lead whiteboard planning
      {
        delay: 10000,
        run: () => {
          eventBus.emitEvent({
            agentId: leadId,
            type: 'planning_started',
            payload: {
              task: 'Architecture Planning & Interface Design',
              tool: 'impact-analysis',
              details: 'Mapped service contracts, data models, and domain boundaries',
              taskId: 'TASK-2',
              progress: 80,
            },
          });
        },
      },
      // Step 5: Tech Lead saves architecture plan
      {
        delay: 13000,
        run: () => {
          eventBus.emitEvent({
            agentId: leadId,
            type: 'file_modified',
            payload: {
              task: 'Architecture Plan Persisted',
              tool: 'write_to_file',
              file: 'scratch/task/FEATURE-101/lead/architecture-plan.md',
              details: 'Persisted component architecture plan and required unit test specifications',
              taskId: 'TASK-2',
              column: 'done',
              phase: 'Architecture Locked',
              milestone: 'Architecture plan & unit test specifications approved for development.',
            },
          });
        },
      },
      // Step 6: Handoff Tech Lead -> Developer
      {
        delay: 16000,
        run: () => {
          eventBus.emitEvent({
            agentId: leadId,
            type: 'agent_handoff',
            payload: {
              fromAgent: leadId,
              toAgent: devId,
              task: 'Implement Feature & Unit Tests',
              allowedSkill: 'code-implementation',
              taskId: 'TASK-3',
              column: 'in_progress',
              phase: 'Implementation',
              details: 'Tech Lead handed component contracts and unit test specs to Developer',
            },
          });
        },
      },
      // Step 7: Developer modifies source file
      {
        delay: 20000,
        run: () => {
          eventBus.emitEvent({
            agentId: devId,
            type: 'file_modified',
            payload: {
              task: 'Coding Authentication Service',
              tool: 'replace_file_content',
              file: 'src/services/auth-service.ts',
              details: 'Implemented token verification and session persistence with strict immutability',
              taskId: 'TASK-3',
              progress: 50,
            },
          });
        },
      },
      // Step 8: Developer authors required unit tests
      {
        delay: 24000,
        run: () => {
          eventBus.emitEvent({
            agentId: devId,
            type: 'file_modified',
            payload: {
              task: 'Authoring AAA Unit Tests',
              tool: 'write_to_file',
              file: 'tests/auth-service.test.ts',
              details: 'Authored 100% of unit test scenarios specified by Tech Lead',
              taskId: 'TASK-3',
              progress: 85,
            },
          });
        },
      },
      // Step 9: Developer compiles / builds code
      {
        delay: 27000,
        run: () => {
          eventBus.emitEvent({
            agentId: devId,
            type: 'command_executing',
            payload: {
              task: 'Building & Type Checking',
              tool: 'run_command',
              command: 'npm run build',
              output: 'vite build: 12 modules transformed.\ndist/index.html   0.45 kB\ndist/assets/index.js   142.12 kB\n✓ built in 190ms',
              details: 'Clean TypeScript compilation; zero syntax or type errors',
              taskId: 'TASK-3',
              column: 'review',
              progress: 100,
            },
          });
        },
      },
      // Step 10: Handoff Developer -> Tech Lead (Code Review)
      {
        delay: 30000,
        run: () => {
          eventBus.emitEvent({
            agentId: devId,
            type: 'agent_handoff',
            payload: {
              fromAgent: devId,
              toAgent: leadId,
              task: 'Senior Code Review Audit',
              allowedSkill: 'code-review',
              taskId: 'TASK-4',
              column: 'in_progress',
              phase: 'Code Review',
              details: 'Developer submitted code diff and unit tests for architectural review',
            },
          });
        },
      },
      // Step 11: Tech Lead audits and approves code review
      {
        delay: 34000,
        run: () => {
          eventBus.emitEvent({
            agentId: leadId,
            type: 'tool_executing',
            payload: {
              task: 'Quality & Standards Audit',
              tool: 'git diff',
              details: 'Checklist: SOLID ✅, Immutability ✅, Boundaries ✅, 100% Unit Tests verified ✅',
              taskId: 'TASK-4',
              column: 'done',
              phase: 'Review Approved',
              milestone: 'Code review approved: zero mutable state leaks, 100% unit tests verified.',
            },
          });
        },
      },
      // Step 12: Handoff Tech Lead -> QA Tester
      {
        delay: 37000,
        run: () => {
          eventBus.emitEvent({
            agentId: leadId,
            type: 'agent_handoff',
            payload: {
              fromAgent: leadId,
              toAgent: testerId,
              task: 'Execute Automated Test Suite & Regression Audit',
              allowedSkill: 'test-execution',
              taskId: 'TASK-5',
              column: 'in_progress',
              phase: 'Verification',
              details: 'Approved code dispatched to QA Tester for automated test execution',
            },
          });
        },
      },
      // Step 13: Tester executes test suite
      {
        delay: 41000,
        run: () => {
          eventBus.emitEvent({
            agentId: testerId,
            type: 'command_executing',
            payload: {
              task: 'Running Test Suite',
              tool: 'run_command',
              command: 'npm test',
              output: 'PASS tests/auth-service.test.ts\n  ✓ validates user session token (4ms)\n  ✓ rejects invalid signature (2ms)\n  ✓ handles token expiration gracefully (3ms)\n\nTest Suites: 1 passed, 1 total\nTests: 18 passed, 18 total\nSnapshots: 0 total\nTime: 1.42s',
              details: 'Running unit test verification in sandbox environment',
            },
          });
        },
      },
      // Step 14: Tester confirms all tests pass
      {
        delay: 45000,
        run: () => {
          eventBus.emitEvent({
            agentId: testerId,
            type: 'test_result',
            payload: {
              task: 'Unit Tests Passed',
              tool: 'run_command',
              command: 'npm test',
              testsPassed: 18,
              testsFailed: 0,
              taskId: 'TASK-5',
              column: 'done',
              file: 'scratch/task/FEATURE-101/tester/test-results.md',
              details: '18 / 18 unit tests passed cleanly with zero regressions',
              milestone: 'All 18 unit tests passed green. Zero regressions found.',
            },
          });
        },
      },
      // Step 15: Handoff Tester -> PM (Delivery Sign-Off)
      {
        delay: 48000,
        run: () => {
          eventBus.emitEvent({
            agentId: testerId,
            type: 'agent_handoff',
            payload: {
              fromAgent: testerId,
              toAgent: pmId,
              task: 'Final Delivery & Sign-Off Report',
              allowedSkill: 'pm-reporting',
              taskId: 'TASK-6',
              column: 'in_progress',
              phase: 'Delivery & Sign-Off',
              details: 'Tester handed off verified test suite report to Project Manager for delivery',
            },
          });
        },
      },
      // Step 16: PM delivers and celebrates
      {
        delay: 52000,
        run: () => {
          eventBus.emitEvent({
            agentId: pmId,
            type: 'task_completed',
            payload: {
              task: 'Feature Delivery Sign-off',
              tool: 'write_to_file',
              file: 'scratch/task/FEATURE-101/pm/delivery-report.md',
              taskId: 'TASK-6',
              column: 'done',
              phase: 'Delivered',
              milestone: '🚀 All tasks verified & completed! Feature delivered to stakeholder.',
              details: 'Project Manager finalized delivery sign-off report to stakeholder.',
            },
          });
          this.stop();
        },
      },
    ];

    // Schedule all steps
    this.timeouts = steps.map((s) => setTimeout(s.run, s.delay));
  }

  stop() {
    this.isRunning = false;
    if (this.timeouts) {
      this.timeouts.forEach(clearTimeout);
      this.timeouts = [];
    }
    console.log('[DemoSimulator] Demonstration scenario stopped.');
  }
}

const globalDemoSimulator = new DemoSimulator();

module.exports = {
  DemoSimulator,
  demoSimulator: globalDemoSimulator,
};
