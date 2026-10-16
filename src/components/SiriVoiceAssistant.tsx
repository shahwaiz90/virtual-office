import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Mic, X, Send, Square, Volume2, ChevronDown, Check, Sparkles, Loader2 } from 'lucide-react';
import { OfficeState, Agent } from '../types/office';
import { voiceService, PRESET_VOICE_OPTIONS } from '../services/voiceService';
import { queryVoiceAssistant, queryVoiceAssistantAsync, AssistantResponse } from '../services/jarvisIntelligence';

interface SiriVoiceAssistantProps {
  isOpen: boolean;
  onClose: () => void;
  state: OfficeState | null;
  isDemo: boolean;
  onToggleDemo: () => void;
  onClearState: () => void;
  onSelectAgent?: (agent: Agent) => void;
  listenTrigger?: number;
}

export const SiriVoiceAssistant: React.FC<SiriVoiceAssistantProps> = ({
  isOpen,
  onClose,
  state,
  isDemo,
  onToggleDemo,
  onClearState,
  onSelectAgent,
  listenTrigger = 0,
}) => {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [typedInput, setTypedInput] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [micNotice, setMicNotice] = useState<string | null>(null);
  const [lastResponse, setLastResponse] = useState<AssistantResponse | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<string>(
    voiceService.getSettings().selectedVoiceName || 'auto'
  );
  const [showVoicePicker, setShowVoicePicker] = useState<boolean>(false);

  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const unsubSpeaking = voiceService.onSpeakingChange((speaking) => {
      setIsSpeaking(speaking);
    });

    const unsubSettings = voiceService.onSettingsChange((s) => {
      setSelectedVoice(s.selectedVoiceName || 'auto');
    });

    return () => {
      unsubSpeaking();
      unsubSettings();
      voiceService.stop();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }
    };
  }, []);

  const handleSelectVoice = (voiceId: string) => {
    setSelectedVoice(voiceId);
    voiceService.updateSettings({ selectedVoiceName: voiceId });
    const preset = PRESET_VOICE_OPTIONS.find((p) => p.id === voiceId);
    const label = preset ? preset.label : voiceId === 'auto' ? 'Automatic Personas' : voiceId;
  };

  // Whenever active project changes, clear cached voice response so old project details are never shown
  const projectKey = `${state?.workflow?.projectPath || ''}::${state?.workflow?.title || ''}`;
  useEffect(() => {
    setLastResponse(null);
  }, [projectKey]);

  // When Siri opens (e.g. user clicks Voice)
  useEffect(() => {
    if (isOpen) {
      voiceService.stop();
      setTranscript('');
      setMicNotice(null);
      setShowInput(false);

      // Only auto-start if microphone permission has ALREADY been granted.
      // If permission is still 'prompt' or ungranted, do NOT auto-call rec.start() in a timeout,
      // because Chrome/Safari suppress programmatic recognition without a user gesture and emit
      // a false-positive 'not-allowed' error before ever showing the permission dialog!
      let isMounted = true;
      const checkAndAutoStart = async () => {
        try {
          if (navigator.permissions && navigator.permissions.query) {
            const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
            if (status.state === 'granted' && isMounted) {
              startListening(false);
              return;
            }
          }
        } catch (e) {
          // Permissions API unsupported; remain in standby
        }
        if (isMounted) {
          setIsListening(false);
        }
      };

      checkAndAutoStart();
      return () => {
        isMounted = false;
      };
    } else {
      voiceService.stop();
      stopListening();
    }
  }, [isOpen, listenTrigger]);

  const startListening = async (requestPermissionDialog = true) => {
    setMicNotice(null);

    if (!voiceService.isRecognitionSupported()) {
      setMicNotice('Voice input not supported in this browser. Please type below.');
      setShowInput(true);
      setIsListening(false);
      return;
    }

    voiceService.stop();

    // 1. When triggered by user gesture, invoke getUserMedia to guarantee the browser's native permission pop-up appears!
    if (requestPermissionDialog && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Release stream tracks immediately as Web Speech API uses its own internal capture
        stream.getTracks().forEach((track) => track.stop());
      } catch (err: any) {
        console.warn('getUserMedia permission result:', err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setMicNotice('Microphone blocked by browser. Allow permission in your address bar icon or type below.');
          setShowInput(true);
          setIsListening(false);
          return;
        }
      }
    }

    setTranscript('');
    setIsListening(true);

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (e) {}
      recognitionRef.current = null;
    }

    try {
      const rec = voiceService.createRecognition(
        (text, isFinal) => {
          setTranscript(text);
          if (isFinal) {
            handleProcessCommand(text);
            stopListening();
          }
        },
        (err) => {
          console.warn('Speech recognition error:', err);
          if (err && (err.error === 'not-allowed' || err.error === 'service-not-allowed')) {
            setMicNotice('Microphone blocked by browser. Allow permission in your address bar icon or type below.');
            setShowInput(true);
          } else if (err && err.error === 'no-speech') {
            setMicNotice('No speech detected. Tap microphone to speak.');
          } else {
            setMicNotice('Listening ended. Tap microphone to speak.');
          }
          stopListening();
        },
        () => {
          setIsListening(false);
        }
      );

      recognitionRef.current = rec;
      rec.start();
    } catch (e: any) {
      console.error('Failed to start speech recognition:', e);
      setIsListening(false);
      setMicNotice('Could not start microphone. Please type below.');
      setShowInput(true);
    }
  };

  const stopListening = () => {
    setIsListening(false);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
      recognitionRef.current = null;
    }
  };

  const handleProcessCommand = async (commandText: string) => {
    if (!commandText.trim()) return;

    setTranscript(commandText);

    // Fast-path immediate action check
    const lower = commandText.trim().toLowerCase();
    if (lower === 'stop' || lower === 'stop demo' || lower === 'stop sprint' || lower === 'pause demo') {
      voiceService.stop();
      if (isDemo) onToggleDemo();
      setLastResponse({
        spokenText: 'Stopping Demo Agentic Workflow now and silencing all speech.',
        displayText: '⏹️ **Stopping Demo Agentic Workflow**\nSimulation stopped and audio output silenced.',
        action: { type: 'STOP_DEMO' },
        highlightBadge: 'STOP DEMO',
      });
      return;
    }

    if (lower === 'clear board' || lower === 'reset' || lower === 'reset board') {
      voiceService.stop();
      onClearState();
      setLastResponse({
        spokenText: 'Resetting workspace state and returning all agents to standby stations.',
        displayText: '🔄 **Resetting Workspace State**\nAll agents returned to standby stations.',
        action: { type: 'CLEAR_BOARD' },
        highlightBadge: 'OFFICE RESET',
      });
      return;
    }

    setIsThinking(true);
    try {
      const response = await queryVoiceAssistantAsync(commandText, state, isDemo);
      setLastResponse(response);

      // Execute actions triggered by command
      if (response.action) {
        if (response.action.type === 'START_DEMO') {
          if (!isDemo) onToggleDemo();
        } else if (response.action.type === 'STOP_DEMO') {
          voiceService.stop();
          if (isDemo) onToggleDemo();
        } else if (response.action.type === 'CLEAR_BOARD') {
          voiceService.stop();
          onClearState();
        } else if (response.action.type === 'FOCUS_AGENT' && response.action.targetAgentId) {
          const target = state?.agents.find((a) => a.id === response.action?.targetAgentId);
          if (target && onSelectAgent) {
            onSelectAgent(target);
          }
        }
      }

      // Speak response via active speech synthesis
      voiceService.speak(response.spokenText, 'assistant');
    } catch (err) {
      console.warn('Voice command processing error:', err);
    } finally {
      setIsThinking(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!typedInput.trim()) return;
    const text = typedInput;
    setTypedInput('');
    setShowInput(false);
    handleProcessCommand(text);
  };

  // Suggestion chips dynamically generated from real configured agents
  // Suggestion chips dynamically generated from real configured agents
  const suggestionChips = useMemo(() => {
    const chips: { label: string; query: string }[] = [
      { label: 'Status', query: 'status' },
      { label: 'Commands', query: 'commands' },
    ];
    const agents = state?.agents || [];
    agents.forEach((ag) => {
      const label = ag.theme?.badge || ag.badgeText || ag.name.split(' ').slice(-1)[0] || 'Agent';
      chips.push({ label, query: `Check ${ag.name}` });
    });
    chips.push({ label: isDemo ? 'Stop Demo' : 'Run Sprint', query: isDemo ? 'stop demo' : 'run sprint' });
    chips.push({ label: 'Reset', query: 'clear board' });
    return chips;
  }, [state?.agents, isDemo]);

  if (!isOpen) return null;

  return (
    /* Non-blocking floating Apple Siri pill in bottom-right */
    <div className="fixed bottom-6 inset-x-4 sm:inset-x-auto sm:right-6 sm:max-w-md z-50 animate-in slide-in-from-bottom-5 duration-300">
      <div className="relative bg-white/95 border border-slate-200/90 shadow-2xl rounded-3xl p-3.5 backdrop-blur-2xl flex flex-col gap-2.5 text-slate-800">
        
        {/* Top Mini Header: Siri Orb + Live Transcript / State */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* Apple Siri Glowing Waveform Orb */}
            <button
              onClick={
                isThinking
                  ? undefined
                  : isSpeaking
                  ? () => voiceService.stop()
                  : isListening
                  ? stopListening
                  : () => startListening(true)
              }
              title={
                isThinking
                  ? 'Consulting model...'
                  : isSpeaking
                  ? 'Click to stop speaking'
                  : isListening
                  ? 'Click to stop listening'
                  : 'Click to speak into microphone'
              }
              className="relative w-11 h-11 rounded-full flex items-center justify-center shrink-0 cursor-pointer active:scale-95 transition-transform"
            >
              {/* Outer Glow */}
              <div
                className={`absolute inset-0 rounded-full blur-md opacity-80 transition-all ${
                  isThinking
                    ? 'bg-gradient-to-tr from-amber-400 via-indigo-500 to-emerald-400 animate-spin opacity-95 scale-110'
                    : isListening
                    ? 'bg-gradient-to-tr from-pink-500 via-purple-500 to-cyan-400 animate-pulse scale-110'
                    : isSpeaking
                    ? 'bg-gradient-to-tr from-cyan-400 via-indigo-500 to-fuchsia-500 animate-pulse'
                    : 'bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500'
                }`}
              />

              {/* Core Siri Swirl Orb */}
              <div className="relative w-9 h-9 rounded-full bg-gradient-to-tr from-blue-600 via-purple-600 to-pink-500 flex items-center justify-center shadow-md">
                {isThinking ? (
                  <Loader2 className="w-4 h-4 text-white animate-spin" />
                ) : isListening ? (
                  <Mic className="w-4 h-4 text-white animate-bounce" />
                ) : isSpeaking ? (
                  <Square className="w-3.5 h-3.5 text-white fill-current" />
                ) : (
                  <Mic className="w-4 h-4 text-white" />
                )}
              </div>
            </button>

            {/* Status / Speech Transcript */}
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                {isThinking ? 'Consulting Model...' : isListening ? 'Listening...' : isSpeaking ? 'Voice Assistant' : 'Siri Voice'}
              </div>
              <div className="text-xs font-semibold text-slate-800 truncate">
                {isThinking
                  ? `Consulting model: "${transcript}"`
                  : transcript
                  ? `"${transcript}"`
                  : isSpeaking
                  ? 'Speaking... (Click to stop)'
                  : isListening
                  ? 'Listening to microphone... Speak now'
                  : micNotice
                  ? micNotice
                  : 'Tap microphone to speak'}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-1.5 shrink-0">

            {/* Choose Voice Dropdown Trigger */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowVoicePicker((prev) => !prev)}
                title="Choose assistant voice persona"
                className="flex items-center gap-1 px-2 py-1 rounded-xl text-[11px] font-bold text-indigo-700 bg-indigo-50/80 hover:bg-indigo-100 border border-indigo-200/80 transition-colors cursor-pointer shadow-2xs"
              >
                <Volume2 className="w-3 h-3 text-indigo-600 shrink-0" />
                <span className="max-w-[70px] truncate">
                  {PRESET_VOICE_OPTIONS.find((p) => p.id === selectedVoice)?.name || 'Voice'}
                </span>
                <ChevronDown className="w-2.5 h-2.5 text-indigo-500 shrink-0" />
              </button>

              {/* Voice Options Popup */}
              {showVoicePicker && (
                <div className="absolute right-0 bottom-full mb-2 w-64 bg-white border border-slate-200 shadow-2xl rounded-2xl p-1.5 z-50 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 border-b border-slate-100 mb-1 flex items-center justify-between">
                    <span>Select Voice Persona</span>
                    <span className="text-[9px] text-indigo-600 font-bold">100% Free</span>
                  </div>
                  <div className="max-h-56 overflow-y-auto space-y-0.5 pr-0.5">
                    {PRESET_VOICE_OPTIONS.map((opt) => {
                      const isSelected = selectedVoice === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            handleSelectVoice(opt.id);
                            setShowVoicePicker(false);
                          }}
                          className={`w-full text-left px-2.5 py-1.5 rounded-xl text-xs flex items-center justify-between transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-indigo-600 text-white font-bold shadow-xs'
                              : 'hover:bg-slate-100 text-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm shrink-0">{opt.flag}</span>
                            <div className="truncate">
                              <div className="truncate font-semibold">{opt.label}</div>
                              <div className={`text-[10px] truncate ${isSelected ? 'text-indigo-100' : 'text-slate-400'}`}>
                                {opt.description}
                              </div>
                            </div>
                          </div>
                          {isSelected && <Check className="w-3.5 h-3.5 shrink-0 ml-1 text-white" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => setShowInput((prev) => !prev)}
              title="Type a command"
              className="px-2 py-1 rounded-xl text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              {showInput ? 'Hide' : 'Type'}
            </button>

            <button
              onClick={onClose}
              title="Close"
              className="p-1 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Text Input Row (Collapsible) */}
        {showInput && (
          <form onSubmit={handleFormSubmit} className="flex items-center gap-2 pt-1 border-t border-slate-100">
            <input
              type="text"
              value={typedInput}
              onChange={(e) => setTypedInput(e.target.value)}
              placeholder="Ask for status, team agents, or run sprint..."
              className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-indigo-500 transition-colors"
              autoFocus
            />
            <button
              type="submit"
              disabled={!typedInput.trim()}
              className="p-1.5 rounded-xl bg-indigo-600 text-white disabled:opacity-40 transition-colors cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        )}

        {/* Assistant Response Card */}
        {lastResponse && (
          <div className="bg-slate-50/90 border border-slate-200/80 rounded-2xl p-2.5 text-xs text-slate-700 leading-snug">
            <div className="line-clamp-3 select-text font-medium whitespace-pre-line">
              {lastResponse.displayText.replace(/[*_#`]/g, '')}
            </div>

            {/* Dynamic Suggestion Chips Bound to Real Agents */}
            <div className="flex flex-wrap gap-1.5 pt-2 mt-2 border-t border-slate-200/60">
              {suggestionChips.map((chip) => (
                <button
                  key={chip.label}
                  onClick={() => handleProcessCommand(chip.query)}
                  className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-white text-indigo-700 border border-indigo-200/80 hover:bg-indigo-50 hover:border-indigo-300 transition-colors cursor-pointer"
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
