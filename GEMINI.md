# Gemini CLI Context Instructions: Virtual Office

> [!IMPORTANT]
> ### 👑 PRIMARY AGENT ROUTING: `tech-pm` (Scrum Master)
> When Gemini CLI interacts with this repository, always orient your context around the Primary Orchestrator **`tech-pm`**.
> Never attempt monolithic direct code authoring without first executing task triage and decomposition.

---

## 👥 Agent Hierarchy & Roles

| Agent ID | Name | Role | Type | Tools |
| :--- | :--- | :--- | :--- | :--- |
| **`tech-pm`** | Scrum Master | *Tech Scrum Master* | **👑 Primary Orchestrator** | `view_file, invoke_subagent, send_message` |
| **`android-tech-lead`** | Android Lead | *Tech Lead* | *Subagent Specialist* | `view_file, run_command, git_diff, invoke_subagent, send_message` |
| **`android-dev`** | Android Dev | *Developer* | *Subagent Specialist* | `view_file, write_to_file, replace_file_content, run_command` |
| **`android-tester`** | Mobile QA | *QA Engineer* | *Subagent Specialist* | `run_command, view_file, git_diff` |

---

## 🔄 Subagent Delegation Protocol & Schemas

When delegating work between agents, adhere strictly to the invocation schema:

```json
{
  "TypeName": "<target-subagent-id>",
  "Role": "<target-subagent-role>",
  "Prompt": "Explicit actionable prompt with expected acceptance criteria.",
  "Model": "inherit",
  "Workspace": "inherit"
}
```

### Allowed Delegation Targets:
- **`tech-pm`** -> [`android-tech-lead`]
- **`android-tech-lead`** -> [`android-dev`, `android-tester`]
- **`android-dev`** -> [`android-tech-lead`]
- **`android-tester`** -> [`android-dev`, `tech-pm`]

---

## 🚫 Strict Prohibited Actions & Boundaries

### `tech-pm`
- 🚫 **No direct code implementation**
- 🚫 **No modifying production source files directly**

### `android-tech-lead`
- 🚫 **No direct implementation commits without review**

### `android-dev`
- 🚫 **No altering architectural boundaries without lead approval**

### `android-tester`
- 🚫 **No modifying production code**

---

## 📚 Domain Skills Directory Mapping

- **`tech-pm`**: [`task-decomposition`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/task-decomposition/SKILL.md)
- **`android-tech-lead`**: [`task-decomposition`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/task-decomposition/SKILL.md), [`android-architecture`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/android-architecture/SKILL.md), [`android-cli`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/android-cli/SKILL.md), [`r8-analyzer`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/r8-analyzer/SKILL.md), [`agp-9-upgrade`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/agp-9-upgrade/SKILL.md), [`android-permissions-security`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/android-permissions-security/SKILL.md), [`android-intent-security`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/android-intent-security/SKILL.md), [`glance-canonical-layouts`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/glance-canonical-layouts/SKILL.md)
- **`android-dev`**: [`task-decomposition`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/task-decomposition/SKILL.md), [`android-cli`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/android-cli/SKILL.md), [`android-architecture`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/android-architecture/SKILL.md), [`gradle-build`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/gradle-build/SKILL.md), [`edge-to-edge`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/edge-to-edge/SKILL.md), [`adaptive`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/adaptive/SKILL.md), [`jetpack-compose-performance`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/jetpack-compose-performance/SKILL.md), [`styles`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/styles/SKILL.md), [`navigation-3`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/navigation-3/SKILL.md), [`navigation-event`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/navigation-event/SKILL.md), [`camerax`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/camerax/SKILL.md), [`media3-cast-integration`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/media3-cast-integration/SKILL.md), [`appfunctions`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/appfunctions/SKILL.md), [`litert-runtime`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/litert-runtime/SKILL.md), [`ml-kit-genai-prompt-api`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/ml-kit-genai-prompt-api/SKILL.md), [`restore-credentials`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/restore-credentials/SKILL.md), [`verified-email`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/verified-email/SKILL.md), [`migrate-xml-views-to-jetpack-compose`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/migrate-xml-views-to-jetpack-compose/SKILL.md), [`android-for-cars-parked-apps`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/android-for-cars-parked-apps/SKILL.md), [`leanback-to-compose-tv-migration`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/leanback-to-compose-tv-migration/SKILL.md), [`wear-compose-m3`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/wear-compose-m3/SKILL.md), [`wear-widgets`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/wear-widgets/SKILL.md), [`display-glasses-with-jetpack-compose-glimmer`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/display-glasses-with-jetpack-compose-glimmer/SKILL.md)
- **`android-tester`**: [`task-decomposition`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/task-decomposition/SKILL.md), [`android-testing`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/android-testing/SKILL.md), [`testing-setup`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/testing-setup/SKILL.md), [`android-profiler`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/android-profiler/SKILL.md), [`android-cli`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/android-cli/SKILL.md), [`gradle-build`](file:///Users/ahmadshahwaiz/Desktop/Virtual Office/.agents/skills/gradle-build/SKILL.md)
