import React, { useState, useEffect } from 'react';
import { X, Volume2, VolumeX, Mic, ArrowRightLeft, Gauge, Check, Sparkles, Folder, FolderOpen } from 'lucide-react';
import { voiceService, OfficeVoiceSettings, PRESET_VOICE_OPTIONS, VoiceOption } from '../services/voiceService';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectPath?: string;
  onOpenChangeDirectory?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  projectPath,
  onOpenChangeDirectory,
}) => {
  const [settings, setSettings] = useState<OfficeVoiceSettings>(voiceService.getSettings());
  const [testSpeaking, setTestSpeaking] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (isOpen) {
      setSettings(voiceService.getSettings());
      setAvailableVoices(voiceService.getAvailableHumanVoices());
    }
  }, [isOpen]);

  const handleUpdate = (partial: Partial<OfficeVoiceSettings>) => {
    // Validate partial has expected keys
    const validKeys = Object.keys(partial).filter(
      (key) => key in voiceService.getSettings()
    );
    const safePartial: Partial<OfficeVoiceSettings> = {};
    validKeys.forEach((key) => {
      // @ts-expect-error - type refinement after filter
      safePartial[key] = partial[key as keyof Partial<OfficeVoiceSettings>];
    });

    try {
      const updated = { ...settings, ...safePartial };
      setSettings(updated);
      voiceService.updateSettings(safePartial);
    } catch (error) {
      console.error('[SettingsModal] Failed to update settings:', error);
    }
  };

  const handleTestSpeech = () => {
    setTestSpeaking(true);
    const selected = settings.selectedVoiceName || 'auto';
    const preset = PRESET_VOICE_OPTIONS.find((p) => p.id === selected);
    const label = preset ? preset.label : selected === 'auto' ? 'Automatic Role Personas' : selected;

    voiceService.speak(
      `Hello! You have chosen ${label}. All virtual office events and speech updates are ready.`,
      'assistant',
      () => setTestSpeaking(false)
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Settings Dialog Card */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-2xl max-w-lg w-full overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
              <Volume2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-slate-900">Virtual Office Preferences</h2>
              <p className="text-[11px] text-slate-400">Configure voice assistant & audio handoffs</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Settings Body */}
        <div className="p-6 space-y-4 text-xs text-slate-700">
          
          {/* Target Project Workspace Directory */}
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200/80">
            <div className="space-y-0.5 max-w-[310px] min-w-0">
              <div className="font-bold text-slate-800 flex items-center gap-1.5">
                <Folder className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Monitored Project Directory</span>
              </div>
              <p className="text-[11px] font-mono text-slate-600 truncate" title={projectPath || 'Current Workspace'}>
                {projectPath || 'Current Workspace'}
              </p>
            </div>

            {onOpenChangeDirectory && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenChangeDirectory();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-amber-800 bg-white hover:bg-amber-100 border border-amber-300 transition-colors shadow-2xs active:scale-95 cursor-pointer shrink-0 ml-2"
              >
                <FolderOpen className="w-3.5 h-3.5 text-amber-600" />
                <span>Change...</span>
              </button>
            )}
          </div>

          {/* Option 1: Master Audio Mute */}
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80">
            <div className="space-y-0.5 max-w-[320px]">
              <div className="font-bold text-slate-800 flex items-center gap-1.5">
                {settings.isMuted ? (
                  <VolumeX className="w-4 h-4 text-rose-500" />
                ) : (
                  <Volume2 className="w-4 h-4 text-indigo-600" />
                )}
                <span>Sound & Audio Output</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Master switch for all synthesized speech and audible agent notifications.
              </p>
            </div>

            <button
              onClick={() => handleUpdate({ isMuted: !settings.isMuted })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                !settings.isMuted ? 'bg-indigo-600' : 'bg-slate-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  !settings.isMuted ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Option 2: Spoken Agent Handoffs */}
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80">
            <div className="space-y-0.5 max-w-[320px]">
              <div className="font-bold text-slate-800 flex items-center gap-1.5">
                <ArrowRightLeft className="w-4 h-4 text-emerald-600" />
                <span>Audible Agent Task Handoffs</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Audibly announce when agents assign stories or delegate tasks to other roles (e.g., Lead → Dev, Dev → QA).
              </p>
            </div>

            <button
              onClick={() => handleUpdate({ speakHandoffsEnabled: !settings.speakHandoffsEnabled })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                settings.speakHandoffsEnabled ? 'bg-emerald-600' : 'bg-slate-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.speakHandoffsEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Option 3: Voice Assistant Feature */}
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80">
            <div className="space-y-0.5 max-w-[320px]">
              <div className="font-bold text-slate-800 flex items-center gap-1.5">
                <Mic className="w-4 h-4 text-cyan-600" />
                <span>Voice Assistant & Siri HUD</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Enable interactive speech-to-text queries and audible standup summaries.
              </p>
            </div>

            <button
              onClick={() => handleUpdate({ voiceAssistantEnabled: !settings.voiceAssistantEnabled })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                settings.voiceAssistantEnabled ? 'bg-cyan-600' : 'bg-slate-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.voiceAssistantEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Option 4: Human Voice Persona / Model */}
          <div className="space-y-2.5 p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80">
            <div className="flex items-center justify-between font-bold text-slate-800">
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-500" />
                <span>Voice Persona / Voice Model</span>
              </span>
              <span className="text-[10px] text-indigo-700 bg-indigo-50 font-bold px-2 py-0.5 rounded-full border border-indigo-200">
                Natural Human Audio
              </span>
            </div>

            <select
              value={settings.selectedVoiceName || 'auto'}
              onChange={(e) => {
                const val = e.target.value;
                handleUpdate({ selectedVoiceName: val });
                const preset = PRESET_VOICE_OPTIONS.find((p) => p.id === val);
                const label = preset ? preset.label : val === 'auto' ? 'Automatic Personas' : val;
                voiceService.speak(`Voice set to ${label}.`, 'assistant');
              }}
              className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-500 transition-colors shadow-2xs"
            >
              <optgroup label="🌟 Curated Natural Voices">
                {PRESET_VOICE_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.flag} {opt.label} — {opt.description}
                  </option>
                ))}
              </optgroup>
              {availableVoices.length > 0 && (
                <optgroup label="💻 Installed System Voices">
                  {availableVoices.map((v) => (
                    <option key={v.name} value={v.name}>
                      🗣️ {v.name} ({v.lang})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>

            {/* Active Voice Description Card */}
            {(() => {
              const currentPreset = PRESET_VOICE_OPTIONS.find(
                (p) => p.id === (settings.selectedVoiceName || 'auto')
              );
              return currentPreset ? (
                <div className="text-[11px] text-slate-600 bg-white/80 border border-slate-200/60 rounded-xl px-3 py-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-medium">
                    <span>{currentPreset.flag}</span>
                    <span>{currentPreset.description}</span>
                  </span>
                  <span className="text-[10px] font-bold uppercase text-slate-400">
                    {currentPreset.gender}
                  </span>
                </div>
              ) : null;
            })()}
          </div>

          {/* Option 5: Speech Rate / Speed Slider */}
          <div className="space-y-2 p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80">
            <div className="flex items-center justify-between font-bold text-slate-800">
              <span className="flex items-center gap-1.5">
                <Gauge className="w-4 h-4 text-blue-600" />
                <span>Speech Speed</span>
              </span>
              <span className="font-mono text-indigo-600">{settings.rate.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="0.8"
              max="1.4"
              step="0.1"
              value={settings.rate}
              onChange={(e) => handleUpdate({ rate: parseFloat(e.target.value) })}
              className="w-full accent-indigo-600 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-400 font-mono">
              <span>0.8x (Measured)</span>
              <span>1.0x (Normal)</span>
              <span>1.4x (Fast)</span>
            </div>
          </div>

          {/* Local Free Synthesis Notice */}
          <div className="p-3 rounded-2xl bg-indigo-50/70 border border-indigo-100 flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
            <div className="text-[11px] text-indigo-900 leading-relaxed">
              <strong>100% Free & Private:</strong> Audio synthesis and speech recognition run entirely on your Mac via native browser engines. No third-party subscriptions or cloud charges.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <button
            onClick={handleTestSpeech}
            disabled={testSpeaking || settings.isMuted}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-indigo-700 bg-white hover:bg-indigo-50 border border-indigo-200 transition-colors shadow-2xs active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span>{testSpeaking ? 'Speaking...' : 'Test Voice'}</span>
          </button>

          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs active:scale-95 transition-all cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Done</span>
          </button>
        </div>

      </div>
    </div>
  );
};
