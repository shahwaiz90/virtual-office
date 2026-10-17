// A client-only walkthrough for first-time users: a scripted request moves through the real team on the
// floor plan. Nothing is sent to the server or written to the board; the steps only feed the handoff
// choreography. The script follows the saved team (orchestrator → its first delegate → that role's
// delegates), so it works for any roster Team Studio produces.
// No runtime imports, so tests can load this file in plain Node.

export interface DemoAgent {
  id: string;
  name: string;
  role?: string;
  isPrimary?: boolean;
  delegationTargets?: string[];
  delegation_targets?: string[];
}

export interface DemoStep {
  fromId: string;
  toId: string;
  /** Card title shown on the flying card and the receiver's bubble */
  title: string;
  key: string;
  /** One sentence for the demo banner */
  caption: string;
}

/** Time between steps: one handoff walk plus a moment for the receiver's bubble */
export const DEMO_STEP_MS = 2600;
const DEMO_REQUEST = 'dark mode toggle';

function delegatesOf(agent: DemoAgent, ids: Set<string>): string[] {
  const list = agent.delegationTargets?.length ? agent.delegationTargets : agent.delegation_targets || [];
  return list.filter((id) => id !== agent.id && ids.has(id));
}

const isTester = (a: DemoAgent) => /\b(qa|test)/i.test(`${a.id} ${a.role || ''}`);

export function buildDemoScript(agents: DemoAgent[]): DemoStep[] {
  if (agents.length < 2) return [];
  const ids = new Set(agents.map((a) => a.id));
  const byId = new Map(agents.map((a) => [a.id, a]));
  const head = agents.find((a) => a.isPrimary) || agents[0];
  const lead = byId.get(delegatesOf(head, ids)[0]) || agents.find((a) => a.id !== head.id)!;

  let workers = delegatesOf(lead, ids)
    .filter((id) => id !== head.id)
    .map((id) => byId.get(id)!);
  // A roster without delegation data: show the next roles in order
  if (!workers.length) workers = agents.filter((a) => a.id !== head.id && a.id !== lead.id).slice(0, 2);
  // Build before test
  workers = [...workers.filter((w) => !isTester(w)), ...workers.filter(isTester)];

  const steps: DemoStep[] = [];
  let n = 1;
  const add = (from: DemoAgent, to: DemoAgent, title: string, caption: string) =>
    steps.push({ fromId: from.id, toId: to.id, title, key: `DEMO-${n++}`, caption });

  add(head, lead, `Plan the ${DEMO_REQUEST}`, `${head.name} turns the request into a card and walks it over to ${lead.name}.`);
  for (const w of workers) {
    if (isTester(w)) {
      add(lead, w, `Test the ${DEMO_REQUEST}`, `${lead.name} asks ${w.name} to test the change against its acceptance criteria.`);
      add(w, lead, 'All checks passed', `${w.name} reports the test results back to ${lead.name}.`);
    } else {
      add(lead, w, `Build the ${DEMO_REQUEST}`, `${lead.name} hands ${w.name} a short contract: the files to change and how to verify.`);
      add(w, lead, 'Ready for review', `${w.name} builds it, checks every criterion and hands it back for review.`);
    }
  }
  if (lead.id !== head.id) add(lead, head, `Done: ${DEMO_REQUEST}`, `${lead.name} approves the work and reports back to ${head.name}. The request is done.`);
  return steps;
}
