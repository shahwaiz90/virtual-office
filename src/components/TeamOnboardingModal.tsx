import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, Users, Sparkles, Check, Plus, Trash2, Shield, Wrench, 
  Smartphone, Apple, Globe, CheckCircle, FileCode, AlertCircle, 
  RefreshCw, Pencil, ArrowLeft, ChevronRight, Search,
  Save, Folder, ArrowRight, Sliders, Layers, Bot, Award, Rocket
} from 'lucide-react';

interface AgentConfig {
  id: string;
  name: string;
  role: string;
  badge: string;
  avatar_url?: string;
  avatarUrl?: string;
  description: string;
  skills: string[];
  allowed_tools: string[];
  prohibited_actions: string[];
  delegation_targets: string[];
  is_primary?: boolean;
  isPrimary?: boolean;
  is_subagent?: boolean;
  isSubagent?: boolean;
  enable_subagent_tools?: boolean;
  enable_write_tools?: boolean;
}

interface TeamTemplate {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  badge: string;
  accentColor: string;
  description: string;
  skills: string[];
  agents: AgentConfig[];
}

interface SkillMeta {
  name: string;
  title: string;
  description: string;
  category: string;
  content?: string;
  onDisk?: boolean;
  path?: string;
}

interface TeamOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
  initialAgentId?: string | null;
}

const ALL_TOOLS = [
  'view_file',
  'write_to_file',
  'replace_file_content',
  'run_command',
  'git_diff',
  'invoke_subagent',
  'send_message',
  'search_web',
];

const PRESET_AVATARS = [
  { url: '/assets/projectmanager.png', label: 'Product Manager / PM' },
  { url: '/assets/techlead.png', label: 'Tech Lead / Architect' },
  { url: '/assets/developer.png', label: 'Core Developer / Engineer' },
  { url: '/assets/qa.png', label: 'QA / Test Engineer' },
  { url: '/assets/designer.png', label: 'UI/UX Designer / Product' },
  { url: '/assets/devops.png', label: 'DevOps & Cloud Engineer' },
  { url: '/assets/security.png', label: 'Security & Compliance' },
  { url: '/assets/scrummaster.png', label: 'Scrum Master & Agile' },
  { url: '/assets/dataengineer.png', label: 'Data & AI Specialist' },
  { url: '/assets/mobiledev.png', label: 'Mobile App Developer' },
  { url: '/assets/writer.png', label: 'Technical Writer / Docs' },
  { url: '/assets/architect_female.png', label: 'Lead Architect (Female)' },
  { url: '/assets/frontend_female.png', label: 'Frontend & Mobile (Female)' },
  { url: '/assets/ai_female.png', label: 'AI & Data Scientist (Female)' },
];

export const TeamOnboardingModal: React.FC<TeamOnboardingModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  initialAgentId,
}) => {
  const [templates, setTemplates] = useState<TeamTemplate[]>([]);
  const [availableSkills, setAvailableSkills] = useState<SkillMeta[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('android');
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  // Every role defined in the project (.agents/definitions); `agents` is the team being edited
  const [catalogAgents, setCatalogAgents] = useState<AgentConfig[]>([]);
  const [selectedAgentIndex, setSelectedAgentIndex] = useState<number>(0);

  // Progressive Disclosure: 'platform' -> 'preview' -> 'studio'
  const [flowStep, setFlowStep] = useState<'platform' | 'preview' | 'studio'>('platform');
  const [viewMode, setViewMode] = useState<'roster' | 'edit' | 'skills'>('roster');

  const [scaffoldSkills, setScaffoldSkills] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasExistingConfig, setHasExistingConfig] = useState<boolean>(true);

  // Skill Editor & Viewer State
  const [editingSkill, setEditingSkill] = useState<SkillMeta | null>(null);
  const [skillContentDraft, setSkillContentDraft] = useState<string>('');
  const [savingSkill, setSavingSkill] = useState<boolean>(false);
  const [skillSaveSuccess, setSkillSaveSuccess] = useState<string | null>(null);
  const [skillSearchQuery, setSkillSearchQuery] = useState<string>('');

  // Load configuration and templates
  const loadInitialData = () => {
    setLoading(true);
    setError(null);
    setSaveSuccess(null);

    Promise.all([
      fetch('/api/agents/templates').then((r) => r.json()),
      fetch('/api/agents/current-config').then((r) => r.json()),
      fetch('/api/skills').then((r) => r.json()).catch(() => ({ skills: [] })),
    ])
      .then(([tmplData, curData, skillsData]) => {
        if (tmplData.success) {
          setTemplates(tmplData.templates || []);
        }

        // Collect comprehensive skills catalog
        const skillsMap = new Map<string, SkillMeta>();
        if (skillsData && skillsData.skills) {
          skillsData.skills.forEach((s: SkillMeta) => skillsMap.set(s.name, s));
        }
        if (tmplData.skills) {
          Object.values(tmplData.skills).forEach((s: any) => {
            if (!skillsMap.has(s.name)) skillsMap.set(s.name, s);
          });
        }
        setAvailableSkills(Array.from(skillsMap.values()));

        const exists = Boolean(curData.success && curData.hasCustomConfig && curData.agents && curData.agents.length > 0);
        setHasExistingConfig(exists);

        if (exists) {
          const toAgentConfig = (a: any): AgentConfig => ({
            id: a.id,
            name: a.name,
            role: a.role,
            badge: a.theme?.badge || a.badgeText || (a.name || 'AGT').slice(0, 3).toUpperCase(),
            avatar_url: a.avatarUrl || a.theme?.avatarUrl || '/assets/developer.png',
            description: a.description || '',
            skills: (a.skills || []).map((s: any) => (typeof s === 'string' ? s : s.id || s.name)),
            allowed_tools: a.allowedTools || ['view_file'],
            prohibited_actions: a.prohibitedActions || [],
            delegation_targets: a.delegationTargets || [],
          });
          // Open with the saved team, in saved order; no saved list (older server) = every agent
          const byId = new Map<string, any>(curData.agents.map((a: any) => [a.id, a]));
          const teamIds: string[] = Array.isArray(curData.team) && curData.team.length > 0
            ? curData.team.filter((id: string) => byId.has(id))
            : curData.agents.map((a: any) => a.id);
          const loadedAgents: AgentConfig[] = teamIds.map((id) => toAgentConfig(byId.get(id)));
          setCatalogAgents(curData.agents.map(toAgentConfig));
          setAgents(loadedAgents);

          const isIos = loadedAgents.some((a) => a.id.startsWith('ios-') || (a.skills || []).some((s) => s.includes('swift') || s.includes('xcode')));
          const isAndroid = loadedAgents.some((a) => a.id.startsWith('android-') || (a.skills || []).some((s) => s.includes('android') || s.includes('gradle') || s.includes('compose')));
          const isWeb = loadedAgents.some((a) => a.id.startsWith('web-') || (a.skills || []).some((s) => s.includes('react') || s.includes('vercel')));
          if (isIos) {
            setSelectedTemplateId('ios');
          } else if (isAndroid) {
            setSelectedTemplateId('android');
          } else if (isWeb) {
            setSelectedTemplateId('web');
          }

          if (initialAgentId) {
            const idx = loadedAgents.findIndex((ag) => ag.id === initialAgentId);
            if (idx !== -1) {
              setSelectedAgentIndex(idx);
              setViewMode('edit');
            } else {
              setViewMode('roster');
            }
            setFlowStep('studio');
          } else {
            // Already configured: show pleasant Team Preview with Customize/Change Platform options
            setFlowStep('preview');
            setViewMode('roster');
          }
        } else {
          // First time / New project: start with Apple-style Platform Selection!
          setCatalogAgents([]);
          const androidTmpl = (tmplData.templates || []).find((t: any) => t.id === 'android') || tmplData.templates[0];
          if (androidTmpl) {
            setSelectedTemplateId(androidTmpl.id);
            setAgents(JSON.parse(JSON.stringify(androidTmpl.agents)));
          }
          setFlowStep('platform');
          setViewMode('roster');
        }
      })
      .catch((err) => {
        setError('Failed to load agent settings: ' + err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    if (isOpen) {
      loadInitialData();
    }
  }, [isOpen, initialAgentId]);

  // Strict Platform Filtering
  const filteredAvailableSkills = useMemo(() => {
    return availableSkills.filter((sk) => {
      if (selectedTemplateId === 'android') {
        return sk.category === 'android' || sk.category === 'common';
      }
      if (selectedTemplateId === 'ios') {
        return sk.category === 'ios' || sk.category === 'common';
      }
      if (selectedTemplateId === 'web') {
        return sk.category === 'web' || sk.category === 'common';
      }
      return true;
    });
  }, [availableSkills, selectedTemplateId]);

  // Search filtered skills
  const searchableSkills = useMemo(() => {
    if (!skillSearchQuery.trim()) return filteredAvailableSkills;
    const q = skillSearchQuery.toLowerCase();
    return filteredAvailableSkills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.title && s.title.toLowerCase().includes(q)) ||
        (s.description && s.description.toLowerCase().includes(q))
    );
  }, [filteredAvailableSkills, skillSearchQuery]);

  // Switch to another starter template
  const handleApplyTemplate = (tmplId: string, advanceToPreview: boolean = false) => {
    setSelectedTemplateId(tmplId);
    const tmpl = templates.find((t) => t.id === tmplId);
    if (tmpl) {
      setAgents(JSON.parse(JSON.stringify(tmpl.agents)));
      setSelectedAgentIndex(0);
    }
    if (advanceToPreview) {
      setFlowStep('preview');
    }
  };

  // Agent property update
  const handleUpdateCurrentAgent = (field: keyof AgentConfig, value: any) => {
    setAgents((prev) => {
      const next = [...prev];
      if (next[selectedAgentIndex]) {
        next[selectedAgentIndex] = { ...next[selectedAgentIndex], [field]: value };
      }
      return next;
    });
  };

  const handleToggleTool = (toolName: string) => {
    const curAgent = agents[selectedAgentIndex];
    if (!curAgent) return;
    const curTools = curAgent.allowed_tools || [];
    const nextTools = curTools.includes(toolName)
      ? curTools.filter((t) => t !== toolName)
      : [...curTools, toolName];
    handleUpdateCurrentAgent('allowed_tools', nextTools);
  };

  const handleAddSkill = async (skillName: string) => {
    if (!skillName) return;
    const curAgent = agents[selectedAgentIndex];
    if (!curAgent) return;
    const curSkills = curAgent.skills || [];
    if (!curSkills.includes(skillName)) {
      handleUpdateCurrentAgent('skills', [...curSkills, skillName]);
    }

    const skillObj = availableSkills.find((s) => s.name === skillName);
    try {
      await fetch('/api/skills/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: skillName,
          content: skillObj?.content || '',
          category: skillObj?.category || (selectedTemplateId === 'ios' ? 'ios' : selectedTemplateId === 'web' ? 'web' : 'android'),
        }),
      });
      setAvailableSkills((prev) =>
        prev.map((s) => (s.name === skillName ? { ...s, onDisk: true, path: `.agents/skills/${skillName}/SKILL.md` } : s))
      );
    } catch (e) {}
  };

  const handleRemoveSkill = (skillName: string) => {
    const curAgent = agents[selectedAgentIndex];
    if (!curAgent) return;
    handleUpdateCurrentAgent(
      'skills',
      (curAgent.skills || []).filter((s) => s !== skillName)
    );
  };

  const handleAddProhibited = (text: string) => {
    if (!text.trim()) return;
    const curAgent = agents[selectedAgentIndex];
    if (!curAgent) return;
    handleUpdateCurrentAgent('prohibited_actions', [
      ...(curAgent.prohibited_actions || []),
      text.trim(),
    ]);
  };

  const handleRemoveProhibited = (idx: number) => {
    const curAgent = agents[selectedAgentIndex];
    if (!curAgent) return;
    handleUpdateCurrentAgent(
      'prohibited_actions',
      (curAgent.prohibited_actions || []).filter((_, i) => i !== idx)
    );
  };

  const handleAddNewAgent = () => {
    const newIdx = agents.length + 1;
    const newAgent: AgentConfig = {
      id: `specialist-${newIdx}`,
      name: `Specialist ${newIdx}`,
      role: 'Domain Specialist',
      badge: 'SPEC',
      avatar_url: '/assets/developer.png',
      description: 'Responsible for domain engineering and custom delivery.',
      skills: selectedTemplateId === 'ios' ? ['swiftui-architecture'] : (selectedTemplateId === 'web' ? ['feature-implementation'] : ['android-architecture']),
      allowed_tools: ['view_file', 'write_to_file', 'run_command'],
      prohibited_actions: [],
      delegation_targets: [],
    };
    setAgents((prev) => [...prev, newAgent]);
    setSelectedAgentIndex(agents.length);
    setFlowStep('studio');
    setViewMode('edit');
  };

  // Catalog roles that are not in the team yet (e.g. the mobile roles), ready to add back
  const catalogRolesOutsideTeam = useMemo(
    () => catalogAgents.filter((c) => !agents.some((a) => a.id === c.id)),
    [catalogAgents, agents]
  );

  const handleAddCatalogAgent = (id: string) => {
    const role = catalogAgents.find((c) => c.id === id);
    if (!role || agents.some((a) => a.id === id)) return;
    setAgents((prev) => [...prev, JSON.parse(JSON.stringify(role))]);
  };

  const handleRemoveAgent = (idx: number) => {
    if (agents.length <= 1) return;
    setAgents((prev) => prev.filter((_, i) => i !== idx));
    setSelectedAgentIndex((prev) => Math.max(0, Math.min(prev, agents.length - 2)));
  };

  // Open Skill File in Editor
  const handleOpenSkillEditor = async (skillName: string) => {
    setSkillSaveSuccess(null);
    let skillObj = availableSkills.find((s) => s.name === skillName);
    
    if (skillObj && skillObj.content) {
      setEditingSkill(skillObj);
      setSkillContentDraft(skillObj.content);
      return;
    }

    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skillName)}`);
      const data = await res.json();
      if (data.success && data.skill) {
        setEditingSkill(data.skill);
        setSkillContentDraft(data.skill.content || '');
      } else {
        const fallback: SkillMeta = {
          name: skillName,
          title: skillName.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' '),
          description: `Custom instructions for ${skillName}`,
          category: selectedTemplateId,
          content: `---\nname: ${skillName}\ndescription: Custom specialized skill for ${skillName}\n---\n# ${skillName}\n\nAdd domain instructions here.\n`,
          onDisk: false,
        };
        setEditingSkill(fallback);
        setSkillContentDraft(fallback.content || '');
      }
    } catch (e) {
      const fallback: SkillMeta = {
        name: skillName,
        title: skillName,
        description: `Custom instructions for ${skillName}`,
        category: selectedTemplateId,
        content: `---\nname: ${skillName}\ndescription: Custom skill\n---\n# ${skillName}\n`,
        onDisk: false,
      };
      setEditingSkill(fallback);
      setSkillContentDraft(fallback.content || '');
    }
  };

  // Save SKILL.md changes to disk
  const handleSaveSkillContent = async () => {
    if (!editingSkill) return;
    setSavingSkill(true);
    setSkillSaveSuccess(null);

    try {
      const res = await fetch('/api/skills/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingSkill.name,
          content: skillContentDraft,
          category: editingSkill.category || selectedTemplateId,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save skill file.');
      }

      setSkillSaveSuccess(`Saved to ${data.path || '.agents/skills/' + editingSkill.name + '/SKILL.md'}`);
      
      setEditingSkill((prev) => (prev ? { ...prev, content: skillContentDraft, onDisk: true, path: data.path } : null));
      setAvailableSkills((prev) =>
        prev.map((s) =>
          s.name === editingSkill.name
            ? { ...s, content: skillContentDraft, onDisk: true, path: data.path }
            : s
        )
      );

      setTimeout(() => {
        setSkillSaveSuccess(null);
      }, 3000);
    } catch (err: any) {
      setError(err.message || 'Error saving skill file.');
    } finally {
      setSavingSkill(false);
    }
  };

  // Submit and save team configuration
  const handleSaveTeam = async () => {
    setSaving(true);
    setError(null);
    setSaveSuccess(null);

    try {
      const res = await fetch('/api/agents/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: selectedTemplateId,
          agents,
          scaffoldSkills,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save team definition.');
      }

      setSaveSuccess(data.message || 'Team successfully staffed and launched!');
      if (onSaved) onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error saving team configuration');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const currentAgent = agents[selectedAgentIndex] || agents[0];

  const getPlatformLabel = (id: string) => {
    if (id === 'android') return 'Android';
    if (id === 'ios') return 'iOS & Apple';
    if (id === 'web') return 'Web & Fullstack';
    return id.toUpperCase();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-scrim/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl max-h-[96vh] sm:max-h-[90vh] flex flex-col bg-surface rounded-2xl sm:rounded-3xl shadow-2xl border border-sand-200/80 overflow-hidden text-sand-800">
        
        {/* Apple-Style Sleek Header */}
        <div className="px-4 py-3.5 sm:px-6 sm:py-4 bg-surface border-b border-sand-100 flex flex-col gap-2.5 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600 shadow-2xs shrink-0">
                <Users className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm sm:text-base font-bold tracking-tight text-sand-900 truncate">
                    {flowStep === 'platform' ? 'Agent Virtual Office Setup' : flowStep === 'preview' ? `${getPlatformLabel(selectedTemplateId)} Team` : 'Team Studio & Skills'}
                  </h2>
                  {flowStep !== 'platform' && (
                    <span className={`text-[9px] sm:text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border shrink-0 ${
                      selectedTemplateId === 'android'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : selectedTemplateId === 'ios'
                        ? 'bg-sky-50 text-sky-700 border-sky-200'
                        : 'bg-brand-50 text-brand-700 border-brand-200'
                    }`}>
                      {selectedTemplateId.toUpperCase()}
                    </span>
                  )}
                </div>
                <p className="text-[11px] sm:text-xs text-sand-500 truncate hidden xs:block">
                  {flowStep === 'platform' 
                    ? 'Select your project platform to configure your specialized AI squad.'
                    : flowStep === 'preview'
                    ? 'Review your 4-agent team squad before staffing desks.'
                    : 'Configure roles, authoritative SKILL.md docs, and tool permissions.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={onClose}
                className="p-1.5 sm:p-2 rounded-xl text-sand-400 hover:text-sand-700 hover:bg-sand-100 transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Clean Stepper Tabs for All Viewports */}
          <div className="flex items-center gap-1 p-1 bg-sand-100 rounded-xl text-xs font-semibold self-start sm:self-auto w-full sm:w-auto overflow-x-auto">
            <button
              type="button"
              onClick={() => setFlowStep('platform')}
              className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap text-xs ${
                flowStep === 'platform'
                  ? 'bg-surface text-brand-700 shadow-xs font-bold'
                  : 'text-sand-600 hover:text-sand-900'
              }`}
            >
              <span>1. Platform</span>
              {flowStep !== 'platform' && <Check className="w-3 h-3 text-emerald-600 stroke-[3]" />}
            </button>
            <button
              type="button"
              onClick={() => setFlowStep('preview')}
              className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap text-xs ${
                flowStep === 'preview'
                  ? 'bg-surface text-brand-700 shadow-xs font-bold'
                  : 'text-sand-600 hover:text-sand-900'
              }`}
            >
              <span>2. Team Preview</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setFlowStep('studio');
                setViewMode('roster');
              }}
              className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap text-xs ${
                flowStep === 'studio'
                  ? 'bg-surface text-brand-700 shadow-xs font-bold'
                  : 'text-sand-500 hover:text-sand-900'
              }`}
            >
              <Sliders className="w-3 h-3" />
              <span>Customize</span>
            </button>
          </div>
        </div>

        {/* Modal Main Content Container */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-7 bg-sand-50/40">
          
          {error && (
            <div className="mb-4 p-3 sm:p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {saveSuccess && (
            <div className="mb-4 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2.5 font-bold animate-in fade-in">
              <CheckCircle className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{saveSuccess}</span>
            </div>
          )}

          {loading ? (
            <div className="py-24 flex flex-col items-center justify-center gap-2.5 text-sand-500">
              <RefreshCw className="w-6 h-6 animate-spin text-brand-600" />
              <span className="text-xs font-semibold">Preparing virtual office setup...</span>
            </div>
          ) : flowStep === 'platform' ? (
            
            /* ========================================================================= */
            /* STEP 1: APPLE-GRADE PROJECT PLATFORM SELECTION                            */
            /* ========================================================================= */
            <div className="max-w-3xl mx-auto space-y-5 sm:space-y-6 py-1 animate-in fade-in duration-200">
              <div className="text-center space-y-1">
                <h3 className="text-lg sm:text-2xl font-bold tracking-tight text-sand-900">
                  What type of project are you building?
                </h3>
                <p className="text-xs sm:text-sm text-sand-500 max-w-md mx-auto">
                  Select your stack to configure official guidelines, skills, and 4 dedicated specialist roles.
                </p>
              </div>

              {/* 3 Responsive Platform Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 sm:gap-4 pt-1">
                
                {/* 1. Android Platform Card */}
                <div
                  onClick={() => handleApplyTemplate('android', true)}
                  className={`group relative p-4 sm:p-5 rounded-2xl sm:rounded-3xl border-2 transition-all duration-200 cursor-pointer flex flex-col justify-between gap-4 bg-surface ${
                    selectedTemplateId === 'android'
                      ? 'border-emerald-500 shadow-sm ring-3 ring-emerald-500/10'
                      : 'border-sand-200/80 hover:border-emerald-300 hover:shadow-sm'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shadow-2xs group-hover:scale-105 transition-transform">
                      <Smartphone className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm sm:text-base font-bold text-sand-900">Android</h4>
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          KOTLIN
                        </span>
                      </div>
                      <p className="text-[11px] sm:text-xs text-sand-500 font-medium mt-0.5">
                        Jetpack Compose • Gradle
                      </p>
                    </div>
                    <p className="text-xs text-sand-600 leading-relaxed">
                      Pre-configured with modern Android architecture, Compose UI performance, R8 shrinking, and unit test suites.
                    </p>
                  </div>

                  <div className="pt-3 border-t border-sand-100 space-y-2">
                    <div className="text-[10px] font-bold text-sand-400 uppercase tracking-wider">
                      Included 4-Agent Team:
                    </div>
                    <div className="flex flex-wrap gap-1 text-[11px] text-sand-600">
                      <span className="px-1.5 py-0.5 rounded bg-sand-100 font-medium">Scrum Master</span>
                      <span className="px-1.5 py-0.5 rounded bg-sand-100 font-medium">Android Lead</span>
                      <span className="px-1.5 py-0.5 rounded bg-sand-100 font-medium">Android Dev</span>
                      <span className="px-1.5 py-0.5 rounded bg-sand-100 font-medium">Mobile QA</span>
                    </div>

                    <button
                      type="button"
                      className="w-full mt-2 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs cursor-pointer"
                    >
                      <span>Select Android</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* 2. iOS Platform Card */}
                <div
                  onClick={() => handleApplyTemplate('ios', true)}
                  className={`group relative p-4 sm:p-5 rounded-2xl sm:rounded-3xl border-2 transition-all duration-200 cursor-pointer flex flex-col justify-between gap-4 bg-surface ${
                    selectedTemplateId === 'ios'
                      ? 'border-sky-500 shadow-sm ring-3 ring-sky-500/10'
                      : 'border-sand-200/80 hover:border-sky-300 hover:shadow-sm'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-sky-50 border border-sky-100 flex items-center justify-center text-sky-600 shadow-2xs group-hover:scale-105 transition-transform">
                      <Apple className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm sm:text-base font-bold text-sand-900">iOS & Apple</h4>
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">
                          SWIFT 6
                        </span>
                      </div>
                      <p className="text-[11px] sm:text-xs text-sand-500 font-medium mt-0.5">
                        SwiftUI • Xcode • Swift Testing
                      </p>
                    </div>
                    <p className="text-xs text-sand-600 leading-relaxed">
                      Tailored for modern Swift Testing, Apple Design Guidelines, Clean SwiftUI Views, and strict Xcode build hardening.
                    </p>
                  </div>

                  <div className="pt-3 border-t border-sand-100 space-y-2">
                    <div className="text-[10px] font-bold text-sand-400 uppercase tracking-wider">
                      Included 4-Agent Team:
                    </div>
                    <div className="flex flex-wrap gap-1 text-[11px] text-sand-600">
                      <span className="px-1.5 py-0.5 rounded bg-sand-100 font-medium">Scrum Master</span>
                      <span className="px-1.5 py-0.5 rounded bg-sand-100 font-medium">iOS Lead</span>
                      <span className="px-1.5 py-0.5 rounded bg-sand-100 font-medium">iOS Dev</span>
                      <span className="px-1.5 py-0.5 rounded bg-sand-100 font-medium">iOS QA</span>
                    </div>

                    <button
                      type="button"
                      className="w-full mt-2 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 bg-sky-600 hover:bg-sky-700 text-white shadow-2xs cursor-pointer"
                    >
                      <span>Select iOS</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* 3. Web Platform Card */}
                <div
                  onClick={() => handleApplyTemplate('web', true)}
                  className={`group relative p-4 sm:p-5 rounded-2xl sm:rounded-3xl border-2 transition-all duration-200 cursor-pointer flex flex-col justify-between gap-4 bg-surface ${
                    selectedTemplateId === 'web'
                      ? 'border-brand-500 shadow-sm ring-3 ring-brand-500/10'
                      : 'border-sand-200/80 hover:border-brand-300 hover:shadow-sm'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600 shadow-2xs group-hover:scale-105 transition-transform">
                      <Globe className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm sm:text-base font-bold text-sand-900">Web & Cloud</h4>
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200">
                          REACT 19
                        </span>
                      </div>
                      <p className="text-[11px] sm:text-xs text-sand-500 font-medium mt-0.5">
                        TypeScript • Vite • Vitest
                      </p>
                    </div>
                    <p className="text-xs text-sand-600 leading-relaxed">
                      Optimized for fullstack web apps, reusable component systems, responsive styling, modern browser APIs, and automated UI tests.
                    </p>
                  </div>

                  <div className="pt-3 border-t border-sand-100 space-y-2">
                    <div className="text-[10px] font-bold text-sand-400 uppercase tracking-wider">
                      Included 4-Agent Team:
                    </div>
                    <div className="flex flex-wrap gap-1 text-[11px] text-sand-600">
                      <span className="px-1.5 py-0.5 rounded bg-sand-100 font-medium">Scrum Master</span>
                      <span className="px-1.5 py-0.5 rounded bg-sand-100 font-medium">Web Lead</span>
                      <span className="px-1.5 py-0.5 rounded bg-sand-100 font-medium">Web Dev</span>
                      <span className="px-1.5 py-0.5 rounded bg-sand-100 font-medium">Web QA</span>
                    </div>

                    <button
                      type="button"
                      className="w-full mt-2 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white shadow-2xs cursor-pointer"
                    >
                      <span>Select Web</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

              </div>
            </div>

          ) : flowStep === 'preview' ? (

            /* ========================================================================= */
            /* STEP 2: APPLE-GRADE "MEET YOUR TEAM" ROSTER PREVIEW                       */
            /* ========================================================================= */
            <div className="space-y-4 sm:space-y-5 max-w-4xl mx-auto py-1 animate-in fade-in duration-200">
              
              {/* Header Navigation */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-sand-200/60">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFlowStep('platform')}
                      className="text-xs font-bold text-sand-500 hover:text-sand-800 flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Change Platform</span>
                    </button>
                    <span className="text-sand-300">•</span>
                    <span className="text-xs font-bold text-brand-700 bg-brand-50 px-2 py-0.5 rounded-full border border-brand-100">
                      {getPlatformLabel(selectedTemplateId)} Stack
                    </span>
                  </div>
                  <h3 className="text-base sm:text-lg font-bold text-sand-900 tracking-tight">
                    Your Autonomous AI Engineering Squad
                  </h3>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-center">
                  <button
                    type="button"
                    onClick={() => {
                      setFlowStep('studio');
                      setViewMode('roster');
                    }}
                    className="text-xs font-bold text-sand-700 hover:text-brand-600 bg-surface hover:bg-sand-50 border border-sand-200 px-3 py-1.5 rounded-xl transition-all cursor-pointer shadow-2xs flex items-center gap-1.5"
                  >
                    <Sliders className="w-3.5 h-3.5 text-sand-500" />
                    <span>Customize Roles</span>
                  </button>
                </div>
              </div>

              {/* 4 Clean Visual Role Cards (Mobile Responsive 1-col on phone, 2-col on tablet/desktop) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                {agents.map((ag, idx) => {
                  const isPrimary = idx === 0 || ag.id === 'tech-pm';
                  
                  return (
                    <div
                      key={ag.id}
                      className="bg-surface rounded-2xl border border-sand-200/90 p-4 sm:p-5 shadow-xs flex flex-col justify-between gap-3.5"
                    >
                      <div className="space-y-2.5">
                        {/* Top: Avatar, Name, Role, Badge */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="relative shrink-0">
                              <img
                                src={ag.avatar_url || ag.avatarUrl || PRESET_AVATARS[idx % PRESET_AVATARS.length].url}
                                alt={ag.name}
                                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl object-cover border-2 border-sand-100 bg-sand-50 shadow-2xs max-w-[40px] max-h-[40px]"
                                style={{ width: 38, height: 38 }}
                              />
                              {isPrimary && (
                                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-400 text-sand-900 flex items-center justify-center text-[9px] shadow-xs">
                                  👑
                                </span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <h4 className="text-sm sm:text-base font-bold text-sand-900 truncate">
                                  {ag.name}
                                </h4>
                                <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-sand-100 text-sand-700 border border-sand-200 shrink-0">
                                  {ag.badge}
                                </span>
                              </div>
                              <div className="text-xs font-semibold text-brand-600 flex items-center gap-1 mt-0.5">
                                <span>{ag.role}</span>
                                {isPrimary ? (
                                  <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 border border-amber-200">
                                    Primary Orchestrator
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-medium text-sand-400">
                                    • Subagent
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Plain English Core Responsibility */}
                        <p className="text-xs text-sand-600 leading-relaxed">
                          {ag.description || 'Executes assigned engineering deliverables and reports completion back to the team.'}
                        </p>
                      </div>

                      {/* Bottom Info: Delegation & Skills */}
                      <div className="pt-2.5 border-t border-sand-100 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] text-sand-500">
                          <span className="font-semibold text-sand-400">Assigned Domain Skills:</span>
                          <span className="font-bold text-sand-700">{(ag.skills || []).length} Skills</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {(ag.skills || []).slice(0, 3).map((sk) => (
                            <span key={sk} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-sand-100 text-sand-600">
                              {sk}
                            </span>
                          ))}
                          {(ag.skills || []).length > 3 && (
                            <span className="text-[10px] text-sand-400 px-1 py-0.5 font-medium">
                              +{(ag.skills || []).length - 3} more
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>

          ) : (

            /* ========================================================================= */
            /* STEP 3: ADVANCED TEAM STUDIO (POWER USERS & SKILL EDITORS)                 */
            /* ========================================================================= */
            <div className="space-y-4 animate-in fade-in duration-200">
              
              {/* Studio Sub-Header */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2.5 border-b border-sand-200/70">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFlowStep('preview')}
                    className="flex items-center gap-1.5 text-xs font-bold text-sand-700 hover:text-sand-900 bg-surface hover:bg-sand-50 border border-sand-200 px-3 py-1.5 rounded-xl transition-all cursor-pointer shadow-2xs"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back to Overview</span>
                  </button>

                  <div className="flex items-center gap-1 p-1 bg-sand-100 rounded-xl text-xs font-bold ml-1">
                    <button
                      type="button"
                      onClick={() => setViewMode('roster')}
                      className={`px-3 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                        viewMode === 'roster' || viewMode === 'edit'
                          ? 'bg-surface text-brand-700 shadow-xs'
                          : 'text-sand-600 hover:text-sand-900'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span>Roles ({agents.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('skills')}
                      className={`px-3 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                        viewMode === 'skills'
                          ? 'bg-surface text-brand-700 shadow-xs'
                          : 'text-sand-600 hover:text-sand-900'
                      }`}
                    >
                      <FileCode className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Skills ({filteredAvailableSkills.length})</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAddNewAgent}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-brand-700 hover:text-brand-900 bg-surface border border-brand-200 hover:border-brand-300 shadow-2xs cursor-pointer transition-all active:scale-95"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Role</span>
                  </button>
                </div>
              </div>

              {catalogRolesOutsideTeam.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Add a role from this project's catalog">
                  <span className="text-xs font-semibold text-sand-500 mr-1">Add from catalog:</span>
                  {catalogRolesOutsideTeam.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleAddCatalogAgent(c.id)}
                      title={`Add ${c.name} (${c.id}) to the team`}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-sand-700 hover:text-brand-800 bg-surface border border-sand-200 hover:border-brand-300 cursor-pointer transition-all active:scale-95"
                    >
                      <Plus className="w-3 h-3" />
                      <span>{c.name}</span>
                      <span className="font-mono text-[10px] text-sand-400">{c.id}</span>
                    </button>
                  ))}
                </div>
              )}

              {viewMode === 'skills' ? (
                /* Advanced Skills Catalog */
                <div className="space-y-3.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div>
                      <h4 className="text-xs font-bold text-sand-900 uppercase tracking-wider">
                        Domain Skills Catalog ({filteredAvailableSkills.length})
                      </h4>
                      <p className="text-xs text-sand-500">
                        Inspect or author <code className="font-mono text-sand-700">SKILL.md</code> files.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-sand-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={skillSearchQuery}
                          onChange={(e) => setSkillSearchQuery(e.target.value)}
                          placeholder="Filter skills..."
                          className="text-xs bg-surface border border-sand-200 rounded-xl pl-8 pr-3 py-1.5 focus:ring-1 focus:ring-brand-500 focus:outline-hidden w-40 sm:w-52"
                        />
                      </div>
                      <button
                        onClick={() => {
                          const newSkillName = prompt('Enter new skill name (e.g. custom-pipeline-check):');
                          if (newSkillName) {
                            handleOpenSkillEditor(newSkillName.trim());
                          }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-brand-700 hover:text-brand-900 bg-surface border border-brand-200 hover:border-brand-300 shadow-2xs cursor-pointer transition-all active:scale-95 shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>New Skill</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {searchableSkills.map((sk) => (
                      <div
                        key={sk.name}
                        className="bg-surface rounded-2xl border border-sand-200 hover:border-brand-300 p-3.5 shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between gap-2.5"
                      >
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="flex items-start gap-2 min-w-0">
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${
                              sk.category === 'android' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                              sk.category === 'ios' ? 'bg-sky-50 text-sky-600 border-sky-100' :
                              'bg-brand-50 text-brand-600 border-brand-100'
                            }`}>
                              <FileCode className="w-3.5 h-3.5" />
                            </div>
                            <div className="min-w-0">
                              <span className="text-xs sm:text-sm font-bold text-sand-900 truncate block">
                                {sk.title || sk.name}
                              </span>
                              <span className="text-[10px] font-mono text-sand-400 block truncate">
                                .agents/skills/{sk.name}/SKILL.md
                              </span>
                            </div>
                          </div>

                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${
                            sk.onDisk
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-sand-100 text-sand-500 border-sand-200'
                          }`}>
                            {sk.onDisk ? 'Saved' : 'Official'}
                          </span>
                        </div>

                        <p className="text-xs text-sand-600 line-clamp-2 leading-relaxed">
                          {sk.description || 'Provides authoritative instructions for development and testing.'}
                        </p>

                        <div className="pt-2 border-t border-sand-100 flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => handleOpenSkillEditor(sk.name)}
                            className="flex items-center gap-1 text-xs font-bold text-brand-600 hover:text-brand-800 hover:bg-brand-50 px-2 py-1 rounded-lg border border-brand-200 transition-colors cursor-pointer"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>View & Edit</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              handleAddSkill(sk.name);
                              setViewMode('edit');
                            }}
                            className="text-[11px] font-semibold text-sand-600 hover:text-brand-600 hover:bg-sand-100 px-2 py-1 rounded-md transition-colors cursor-pointer"
                          >
                            + Assign
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : viewMode === 'roster' ? (
                /* Advanced Roster Grid */
                <div className="space-y-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {agents.map((ag, idx) => (
                      <div
                        key={ag.id || idx}
                        onClick={() => {
                          setSelectedAgentIndex(idx);
                          setViewMode('edit');
                        }}
                        className="group bg-surface rounded-2xl border border-sand-200 hover:border-brand-400 p-3.5 sm:p-4 shadow-2xs hover:shadow-xs transition-all cursor-pointer flex flex-col justify-between gap-2.5 relative"
                      >
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <img
                              src={ag.avatar_url || ag.avatarUrl || '/assets/developer.png'}
                              alt={ag.name}
                              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl object-cover border border-sand-200 bg-sand-50 shrink-0 max-w-[36px] max-h-[36px]"
                              style={{ width: 36, height: 36 }}
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs sm:text-sm font-bold text-sand-900 truncate">
                                  {ag.name}
                                </span>
                                <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-brand-50 text-brand-700 border border-brand-200 shrink-0">
                                  {ag.badge}
                                </span>
                                {idx === 0 && (
                                  <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded-full bg-amber-50 text-amber-700 border border-amber-300 shadow-2xs">
                                    👑 Primary
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-sand-500 truncate font-medium">
                                {ag.role}
                              </div>
                            </div>
                          </div>

                          <span className="text-[11px] font-semibold text-brand-600 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 shrink-0">
                            Edit <ChevronRight className="w-3 h-3" />
                          </span>
                        </div>

                        <p className="text-xs text-sand-600 line-clamp-2 leading-relaxed">
                          {ag.description || 'Responsible for project tasks and engineering delivery.'}
                        </p>

                        <div className="pt-2 border-t border-sand-100 flex flex-wrap items-center gap-1">
                          {(ag.skills || []).slice(0, 3).map((sk) => (
                            <span
                              key={sk}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenSkillEditor(sk);
                              }}
                              className="inline-flex items-center gap-1 text-[10px] font-semibold bg-sand-100 hover:bg-brand-50 text-sand-700 hover:text-brand-700 rounded px-1.5 py-0.5 transition-colors border border-transparent hover:border-brand-200"
                            >
                              <FileCode className="w-2.5 h-2.5 text-brand-500" />
                              <span>{sk}</span>
                            </span>
                          ))}
                          {(ag.skills || []).length > 3 && (
                            <span className="text-[10px] text-sand-400 font-medium px-1">
                              +{(ag.skills || []).length - 3} more
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* Advanced Single Role Editor */
                <div className="space-y-4 bg-surface p-4 sm:p-5 rounded-2xl border border-sand-200 shadow-xs">
                  <div className="flex items-center justify-between gap-2.5 pb-2.5 border-b border-sand-100">
                    <div className="flex items-center gap-2 overflow-x-auto py-1 min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => setViewMode('roster')}
                        className="flex items-center gap-1.5 text-xs font-bold text-sand-700 hover:text-sand-900 hover:bg-sand-100 px-2.5 py-1.5 rounded-xl border border-sand-200 transition-colors cursor-pointer shrink-0 shadow-2xs"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>All Roles</span>
                      </button>

                      <div className="h-5 w-px bg-sand-200 shrink-0 mx-0.5" />

                      <div className="flex items-center gap-1.5">
                        {agents.map((ag, idx) => (
                          <button
                            key={ag.id || idx}
                            type="button"
                            onClick={() => setSelectedAgentIndex(idx)}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 ${
                              idx === selectedAgentIndex
                                ? 'bg-brand-50 text-brand-700 border border-brand-200 shadow-2xs'
                                : 'text-sand-600 hover:text-sand-900 hover:bg-sand-100 border border-transparent'
                            }`}
                          >
                            <img
                              src={ag.avatar_url || ag.avatarUrl || PRESET_AVATARS[idx % PRESET_AVATARS.length].url}
                              alt={ag.name}
                              className="w-4 h-4 rounded-full object-cover border border-sand-200 bg-surface shrink-0"
                              style={{ width: 16, height: 16 }}
                            />
                            <span className="truncate max-w-[100px]">{ag.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {currentAgent && (
                    <div className="space-y-4">
                      {/* Identity Row */}
                      <div className="p-3.5 sm:p-4 bg-sand-50/70 rounded-2xl border border-sand-200/80 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5">
                            <div className="relative w-9 h-9 rounded-xl border border-brand-200 bg-surface shadow-2xs p-0.5 flex items-center justify-center shrink-0">
                              <img
                                src={currentAgent.avatar_url || currentAgent.avatarUrl || PRESET_AVATARS[0].url}
                                alt="Current avatar"
                                className="w-full h-full rounded-lg object-cover max-w-[32px] max-h-[32px]"
                                style={{ width: 32, height: 32 }}
                              />
                            </div>
                            <div className="space-y-1">
                              <input
                                type="text"
                                value={currentAgent.name}
                                onChange={(e) => handleUpdateCurrentAgent('name', e.target.value)}
                                placeholder="Agent Name"
                                className="text-xs font-bold text-sand-900 bg-surface border border-sand-200 rounded-lg px-2.5 py-1 focus:ring-1 focus:ring-brand-500 focus:outline-hidden w-full sm:w-44"
                              />
                              <input
                                type="text"
                                value={currentAgent.role}
                                onChange={(e) => handleUpdateCurrentAgent('role', e.target.value)}
                                placeholder="Role Title"
                                className="text-[11px] text-sand-600 bg-surface border border-sand-200 rounded-lg px-2.5 py-1 focus:ring-1 focus:ring-brand-500 focus:outline-hidden w-full sm:w-56 block"
                              />
                            </div>
                          </div>

                          <div className="flex items-center sm:flex-col sm:items-end justify-between sm:justify-start gap-2 shrink-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-bold text-sand-400 uppercase">Badge:</span>
                              <input
                                type="text"
                                value={currentAgent.badge}
                                onChange={(e) => handleUpdateCurrentAgent('badge', e.target.value.toUpperCase())}
                                maxLength={4}
                                className="text-xs font-extrabold text-brand-700 bg-brand-50 border border-brand-200 rounded-lg px-2 py-1 w-16 text-center uppercase focus:bg-surface focus:ring-1 focus:ring-brand-500 focus:outline-hidden"
                              />
                            </div>

                            {agents.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  handleRemoveAgent(selectedAgentIndex);
                                  setViewMode('roster');
                                }}
                                className="px-2 py-1 rounded-lg text-rose-600 hover:bg-rose-50 border border-rose-200 transition-colors cursor-pointer text-[11px] font-bold flex items-center gap-1 active:scale-95 shadow-2xs self-end"
                                title="Delete this role from team"
                              >
                                <Trash2 className="w-3 h-3 text-rose-500" />
                                <span>Delete Role</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Avatar Rack */}
                        <div className="pt-2 border-t border-sand-200/60">
                          <div className="text-[10px] font-bold text-sand-400 uppercase tracking-wider mb-1.5">
                            Choose Avatar
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {PRESET_AVATARS.map((av) => {
                              const isCurrent = (currentAgent.avatar_url || currentAgent.avatarUrl) === av.url;
                              return (
                                <button
                                  key={av.url}
                                  type="button"
                                  onClick={() => handleUpdateCurrentAgent('avatar_url', av.url)}
                                  className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg border transition-all p-0.5 cursor-pointer flex items-center justify-center shrink-0 ${
                                    isCurrent
                                      ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-500/20 scale-105 shadow-2xs'
                                      : 'border-sand-200 bg-surface hover:border-sand-400 hover:scale-105'
                                  }`}
                                  style={{ width: 32, height: 32 }}
                                  title={av.label}
                                >
                                  <img 
                                    src={av.url} 
                                    alt={av.label} 
                                    className="w-full h-full rounded-md object-cover max-w-[26px] max-h-[26px]"
                                    style={{ width: 26, height: 26 }}
                                  />
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Description */}
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-sand-700">Role Purpose & Responsibilities</label>
                        <textarea
                          value={currentAgent.description}
                          onChange={(e) => handleUpdateCurrentAgent('description', e.target.value)}
                          rows={2}
                          className="w-full text-xs text-sand-700 bg-surface border border-sand-200 rounded-xl p-2.5 focus:ring-1 focus:ring-brand-500 focus:outline-hidden"
                          placeholder="Describe what this role accomplishes..."
                        />
                      </div>

                      {/* Tools Allowed */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-sand-700">Allowed Tool Access</label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                          {ALL_TOOLS.map((t) => {
                            const isAllowed = (currentAgent.allowed_tools || []).includes(t);
                            return (
                              <button
                                key={t}
                                type="button"
                                onClick={() => handleToggleTool(t)}
                                className={`flex items-center gap-1.5 p-2 rounded-xl border text-xs font-medium transition-all text-left cursor-pointer ${
                                  isAllowed
                                    ? 'bg-brand-50/80 border-brand-200 text-brand-900 shadow-2xs font-semibold'
                                    : 'bg-surface border-sand-200 text-sand-500 hover:bg-sand-50'
                                }`}
                              >
                                <div className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[9px] ${
                                  isAllowed ? 'bg-brand-600 text-white' : 'border border-sand-300'
                                }`}>
                                  {isAllowed && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                                </div>
                                <span className="font-mono text-[10px] truncate">{t}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Safety Guardrails */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-sand-700">Strict Safety Rules (Prohibited Actions)</label>
                        <div className="space-y-1.5">
                          {(currentAgent.prohibited_actions || []).map((p, pIdx) => (
                            <div key={pIdx} className="flex items-center justify-between p-2 rounded-xl bg-rose-50/50 border border-rose-100 text-xs text-rose-900">
                              <span className="flex items-center gap-1.5 truncate">
                                <Shield className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                                <span className="truncate">{p}</span>
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRemoveProhibited(pIdx)}
                                className="text-rose-400 hover:text-rose-600 cursor-pointer p-0.5 ml-2 shrink-0"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                          <div className="flex items-center gap-2 pt-1">
                            <input
                              type="text"
                              id="new-prohibited-input"
                              placeholder="e.g. No direct production commits without review"
                              className="flex-1 text-xs bg-surface border border-sand-200 rounded-xl px-3 py-1.5 focus:ring-1 focus:ring-brand-500 focus:outline-hidden"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleAddProhibited(e.currentTarget.value);
                                  e.currentTarget.value = '';
                                }
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const el = document.getElementById('new-prohibited-input') as HTMLInputElement;
                                if (el && el.value) {
                                  handleAddProhibited(el.value);
                                  el.value = '';
                                }
                              }}
                              className="px-3 py-1.5 bg-sand-100 hover:bg-sand-200 text-sand-700 text-xs font-bold rounded-xl cursor-pointer shrink-0"
                            >
                              Add Rule
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

            </div>
          )}

        </div>

        {/* Modal Bottom Action Bar (Persistent Across Preview & Studio, Hidden on Platform Step) */}
        {flowStep !== 'platform' && (
          <div className="px-4 py-3 sm:px-6 sm:py-3.5 bg-surface border-t border-sand-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shrink-0 animate-in fade-in">
            <div className="text-[11px] sm:text-xs text-sand-500 flex items-center gap-1.5 justify-center sm:justify-start">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <span className="truncate">Saves to <code className="text-sand-800 bg-sand-100 px-1 py-0.2 rounded font-mono text-[10px]">.agents/agents.json</code></span>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              {flowStep === 'studio' && (
                <button
                  type="button"
                  onClick={() => setFlowStep('preview')}
                  className="flex-1 sm:flex-initial px-3.5 py-2 rounded-xl text-xs font-bold text-sand-600 hover:text-sand-800 hover:bg-sand-100 transition-colors cursor-pointer text-center"
                >
                  Done Customizing
                </button>
              )}

              <button
                onClick={onClose}
                disabled={saving}
                className="flex-1 sm:flex-initial px-3.5 py-2 rounded-xl text-xs font-bold text-sand-600 hover:text-sand-800 hover:bg-sand-100 transition-colors cursor-pointer text-center"
              >
                Cancel
              </button>

              <button
                onClick={handleSaveTeam}
                disabled={saving || agents.length === 0}
                className="flex-1 sm:flex-initial px-5 py-2 rounded-xl text-xs sm:text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 active:scale-95 shadow-md transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Staffing...</span>
                  </>
                ) : (
                  <>
                    <Rocket className="w-3.5 h-3.5" />
                    <span>Staff Team & Launch</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Embedded Fullscreen SKILL.md Markdown Editor Modal */}
        {editingSkill && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-scrim/60 backdrop-blur-md animate-in fade-in duration-150">
            <div className="relative w-full max-w-3xl max-h-[90vh] flex flex-col bg-surface rounded-2xl sm:rounded-3xl shadow-2xl border border-sand-200 overflow-hidden text-sand-800">
              {/* Header */}
              <div className="theme-static px-4 py-3 sm:px-6 sm:py-3.5 bg-sand-900 text-white flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30 shrink-0">
                    <FileCode className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xs sm:text-sm font-bold font-mono text-emerald-400 truncate">
                      {editingSkill.name}/SKILL.md
                    </h3>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setEditingSkill(null)}
                  className="p-1 rounded-lg text-sand-400 hover:text-white hover:bg-sand-800 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Editor Body */}
              <div className="theme-static p-3 sm:p-4 flex-1 flex flex-col min-h-[300px] bg-sand-900">
                <textarea
                  value={skillContentDraft}
                  onChange={(e) => setSkillContentDraft(e.target.value)}
                  className="w-full flex-1 min-h-[280px] bg-sand-950 text-emerald-300 font-mono text-xs p-3.5 rounded-xl border border-sand-800 focus:outline-hidden focus:ring-1 focus:ring-brand-500 resize-none leading-relaxed"
                  placeholder="Enter SKILL.md markdown instructions here..."
                />
              </div>

              {/* Footer */}
              <div className="px-4 py-3 sm:px-6 sm:py-3 bg-surface border-t border-sand-200 flex items-center justify-between gap-2">
                <div className="text-xs truncate">
                  {skillSaveSuccess ? (
                    <span className="text-emerald-600 font-bold flex items-center gap-1 animate-in fade-in truncate">
                      <CheckCircle className="w-3.5 h-3.5 shrink-0" /> {skillSaveSuccess}
                    </span>
                  ) : (
                    <span className="text-sand-400 text-[10px] sm:text-[11px] truncate">Instructions enforced on next run</span>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditingSkill(null)}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold text-sand-600 hover:bg-sand-100 transition-colors cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveSkillContent}
                    disabled={savingSkill}
                    className="px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 active:scale-95 shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {savingSkill ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    <span>Save</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
