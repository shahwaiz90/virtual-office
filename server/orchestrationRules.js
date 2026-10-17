/**
 * server/orchestrationRules.js
 * 
 * OrchestrationRules Engine
 * 
 * Centralizes multi-agent team role resolution, normalization of AI-produced task breakdowns,
 * and event transition side-effect rules.
 * Decouples business logic from the EventBus transport layer.
 */

class OrchestrationRules {
  /**
   * Platform of an agent, by ID only: 'web' | 'android' | 'ios' | null
   * (prefix 'web-' / 'android-' / 'ios-', or the exact id 'web' / 'android' / 'ios').
   */
  static platformOf(agentId) {
    if (!agentId) return null;
    const id = String(agentId).toLowerCase().trim();
    for (const p of ['web', 'android', 'ios']) {
      if (id === p || id.startsWith(`${p}-`)) return p;
    }
    return null;
  }

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
   * 6. Platform teams: `teams[platform] = { lead, dev, tester }` per platform present (same ID rules,
   *    scoped to that platform), and `defaultPlatform` (the pm's first delegation target's platform,
   *    else the first platform in roster order). On a multi-platform roster the default team supplies
   *    lead/dev/tester and the platform badge.
   */
  static resolveTeamRoles(agentsMapOrList) {
    const list = Array.isArray(agentsMapOrList)
      ? agentsMapOrList
      : Array.from(agentsMapOrList ? agentsMapOrList.values() : []);

    if (!list || list.length === 0) {
      const fallback = { id: 'agent-1', name: 'Agent', role: 'Specialist', badge: 'AGT' };
      return { pm: fallback, lead: fallback, dev: fallback, tester: fallback, platformBadge: 'TSK', teams: {}, defaultPlatform: null, list: [] };
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
    let lead =
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
    let dev =
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
    let tester =
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

    // 5. Platform teams (web / android / ios), keyed by agent ID prefix, in roster order
    const platforms = [];
    for (const a of list) {
      const p = this.platformOf(a && a.id);
      if (p && !platforms.includes(p)) platforms.push(p);
    }
    const teams = {};
    for (const p of platforms) {
      const members = list.filter((a) => a.id !== pm.id && this.platformOf(a.id) === p);
      const tLead =
        members.find(
          (a) =>
            hasId(a, [`${p}-tech-lead`, 'tech-lead', 'lead'], ['-tech-lead', '-lead']) ||
            a.enable_subagent_tools === true ||
            (Array.isArray(a.allowed_tools) && a.allowed_tools.includes('invoke_subagent')) ||
            (Array.isArray(a.tools) && a.tools.includes('invoke_subagent')) ||
            a.badge === 'LEAD'
        ) || null;
      const tDev =
        members.find(
          (a) =>
            (!tLead || a.id !== tLead.id) &&
            (hasId(a, [`${p}-dev`, 'dev', 'developer'], ['-dev', '-developer']) || a.badge === 'DEV')
        ) || null;
      const tTester =
        members.find(
          (a) =>
            (!tLead || a.id !== tLead.id) &&
            (!tDev || a.id !== tDev.id) &&
            (hasId(a, [`${p}-tester`, 'tester', 'qa'], ['-tester', '-qa']) || a.badge === 'QA' || a.badge === 'TEST')
        ) || null;
      teams[p] = { lead: tLead, dev: tDev, tester: tTester };
    }

    // 6. Default platform: the pm's first delegation target, else the first platform in roster order
    const pmTargets = pm.delegation_targets || pm.handoffTo || pm.delegationTargets || [];
    const targetPlatform = Array.isArray(pmTargets) && pmTargets.length ? this.platformOf(pmTargets[0]) : null;
    const defaultPlatform = (targetPlatform && teams[targetPlatform] ? targetPlatform : null) || platforms[0] || null;

    // 7. On a multi-platform roster the default team supplies lead/dev/tester. A single-platform
    // roster keeps the roster-wide resolution above unchanged.
    if (platforms.length > 1 && defaultPlatform) {
      const team = teams[defaultPlatform];
      if (team.lead) lead = team.lead;
      if (team.dev) dev = team.dev;
      if (team.tester) tester = team.tester;
    }

    const PLATFORM_BADGES = { web: 'WEB', android: 'AND', ios: 'IOS' };
    const platformBadge = (defaultPlatform && PLATFORM_BADGES[defaultPlatform]) || 'TSK';

    return {
      pm,
      lead,
      dev,
      tester,
      platformBadge,
      teams,
      defaultPlatform,
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
      const key = String((t && t.key) || '');
      // Prompt cards (CC-<hash>) carry a hash, not a sequence number
      if (/^CC-/i.test(key)) continue;
      const m = key.match(/-(\d+)$/);
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
}

module.exports = {
  OrchestrationRules,
};
