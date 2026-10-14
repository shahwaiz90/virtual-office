const { eventBus } = require('./eventBus');

class DemoSimulator {
  constructor() {
    this.timer = null;
    this.isRunning = false;
    this.stepIndex = 0;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.stepIndex = 0;
    eventBus.resetWorkflow('DEMO: DXDT-25243 (eSIM Activation Defect Fix)');

    console.log('[DemoSimulator] Starting realistic multi-agent presentation simulation...');

    // Announce demo simulation mode
    eventBus.emitEvent({
      agentId: 'project-manager',
      type: 'milestone_update',
      payload: {
        phase: 'Intake & Triage',
        milestone: '⚠️ SIMULATION DEMO STARTED: Ingesting DXDT-25243 (eSIM Activation Defect).',
        details: 'Simulated multi-agent workflow started for management presentation.',
      },
    });

    const steps = [
      // Step 1: PM analyzes requirement
      {
        delay: 2000,
        run: () => {
          eventBus.emitEvent({
            agentId: 'project-manager',
            type: 'tool_executing',
            payload: {
              task: 'Jira Auto-Ingestion',
              tool: 'read_jira.py',
              command: 'python3 android-ai-playbook/scripts/read_jira.py "DXDT-25243" -o .agents/scratch/DXDT-25243.md',
              details: 'Auto-ingested ticket DXDT-25243 without manual copy-pasting',
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
            agentId: 'project-manager',
            type: 'task_started',
            payload: {
              task: 'Sizing in Minutes',
              tool: 'write_to_file',
              file: 'scratch/task/DXDT-25243/pm/estimation.md',
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
            agentId: 'project-manager',
            type: 'agent_handoff',
            payload: {
              fromAgent: 'project-manager',
              toAgent: 'android-tech-lead',
              task: '5-Tier Architecture Scoping & Test Specs',
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
            agentId: 'android-tech-lead',
            type: 'planning_started',
            payload: {
              task: 'Architecture Planning & Pre-Mapping',
              tool: 'impact-analysis',
              details: 'Pre-mapped Group A targets, Group B wiring, and identified business rules',
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
            agentId: 'android-tech-lead',
            type: 'file_modified',
            payload: {
              task: 'Architecture Plan Persisted',
              tool: 'write_to_file',
              file: 'scratch/task/DXDT-25243/lead/architecture-plan.md',
              details: 'Persisted 5-tier plan and 3 required unit test cases to scratch',
              taskId: 'TASK-2',
              column: 'done',
              phase: 'Architecture Locked',
              milestone: 'Architecture plan & unit test specifications approved for development.',
            },
          });
        },
      },
      // Step 6: Handoff Tech Lead -> Android Developer
      {
        delay: 16000,
        run: () => {
          eventBus.emitEvent({
            agentId: 'android-tech-lead',
            type: 'agent_handoff',
            payload: {
              fromAgent: 'android-tech-lead',
              toAgent: 'android-dev',
              task: 'Implement Feature & Unit Tests',
              allowedSkill: '08-unit-tests',
              taskId: 'TASK-3',
              column: 'in_progress',
              phase: 'Implementation',
              details: 'Tech Lead handed layer implementation and required unit test specs to Developer',
            },
          });
        },
      },
      // Step 7: Developer modifies Kotlin files
      {
        delay: 20000,
        run: () => {
          eventBus.emitEvent({
            agentId: 'android-dev',
            type: 'file_modified',
            payload: {
              task: 'Coding Domain Provider',
              tool: 'replace_file_content',
              file: 'coredata/src/main/java/com/app/coredata/provider/AuthProvider.kt',
              details: 'Implemented state persistence and error handling with strict val immutability',
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
            agentId: 'android-dev',
            type: 'file_modified',
            payload: {
              task: 'Authoring AAA Unit Tests',
              tool: 'write_to_file',
              file: 'coredata/src/test/java/com/app/coredata/provider/AuthProviderTest.kt',
              details: 'Authored 100% of unit test scenarios specified by Tech Lead using MockK',
              taskId: 'TASK-3',
              progress: 85,
            },
          });
        },
      },
      // Step 9: Developer compiles Kotlin
      {
        delay: 27000,
        run: () => {
          eventBus.emitEvent({
            agentId: 'android-dev',
            type: 'command_executing',
            payload: {
              task: 'Compiling Kotlin Sources',
              tool: 'run_command',
              command: './gradlew compileDevDebugSources',
              output: 'BUILD SUCCESSFUL in 4s (24 actionable tasks: 2 executed, 22 up-to-date)',
              details: 'Clean Kotlin compilation; zero syntax or type errors',
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
            agentId: 'android-dev',
            type: 'agent_handoff',
            payload: {
              fromAgent: 'android-dev',
              toAgent: 'android-tech-lead',
              task: '10-Point Senior Code Review',
              allowedSkill: '10-code-review',
              taskId: 'TASK-4',
              column: 'in_progress',
              phase: 'Code Review',
              details: 'Developer submitted code diff and unit tests for 10-point audit',
            },
          });
        },
      },
      // Step 11: Tech Lead audits and approves code review
      {
        delay: 34000,
        run: () => {
          eventBus.emitEvent({
            agentId: 'android-tech-lead',
            type: 'tool_executing',
            payload: {
              task: '10-Point Checklist Audit',
              tool: 'git diff',
              details: 'Checklist: SOLID ✅, Immutability ✅, Boundaries ✅, 100% Unit Tests verified ✅',
              taskId: 'TASK-4',
              column: 'done',
              phase: 'Review Approved',
              milestone: 'Code review approved: zero mutable var, 100% unit tests verified.',
            },
          });
        },
      },
      // Step 12: Handoff Tech Lead -> QA Tester
      {
        delay: 37000,
        run: () => {
          eventBus.emitEvent({
            agentId: 'android-tech-lead',
            type: 'agent_handoff',
            payload: {
              fromAgent: 'android-tech-lead',
              toAgent: 'android-tester',
              task: 'Execute Unit Tests & Regression Audit',
              allowedSkill: 'execution',
              taskId: 'TASK-5',
              column: 'in_progress',
              phase: 'Verification',
              details: 'Approved code dispatched to QA Tester for automated Gradle execution',
            },
          });
        },
      },
      // Step 13: Tester executes Gradle test suite
      {
        delay: 41000,
        run: () => {
          eventBus.emitEvent({
            agentId: 'android-tester',
            type: 'command_executing',
            payload: {
              task: 'Running Gradle Test Suite',
              tool: 'run_command',
              command: './gradlew testDebugUnitTest',
              output: 'Executing testDebugUnitTest...\n> Task :coredata:testDebugUnitTest\nEsimProviderTest > activateEsim_success PASSED\nEsimProviderTest > activateEsim_failure PASSED\nEsimProviderTest > activateEsim_boundaryCheck PASSED\nBUILD SUCCESSFUL in 8s',
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
            agentId: 'android-tester',
            type: 'test_result',
            payload: {
              task: 'Unit Tests Passed',
              tool: 'run_command',
              command: './gradlew testDebugUnitTest',
              testsPassed: 18,
              testsFailed: 0,
              taskId: 'TASK-5',
              column: 'done',
              file: 'scratch/task/DXDT-25243/tester/unit-test-report.md',
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
            agentId: 'android-tester',
            type: 'agent_handoff',
            payload: {
              fromAgent: 'android-tester',
              toAgent: 'project-manager',
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
            agentId: 'project-manager',
            type: 'task_completed',
            payload: {
              task: 'Feature Delivery Sign-off',
              tool: 'write_to_file',
              file: 'scratch/task/DXDT-25243/pm/delivery-report.md',
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
