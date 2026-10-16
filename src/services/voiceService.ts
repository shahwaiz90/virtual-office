/**
 * Free Web Speech Synthesis & Recognition Service
 * Uses authentic human voices (Siri, Ava, Samantha, Google Natural) without artificial pitch distortion.
 * Explicitly blacklists legacy robotic synthesizers (Moira, Tessa, Karen, Fred, etc.).
 */

export interface VoiceProfile {
  pitch: number;
  rate: number;
  preferredVoices: string[];
}

export interface OfficeVoiceSettings {
  voiceAssistantEnabled: boolean;
  speakHandoffsEnabled: boolean;
  volume: number; // 0.0 to 1.0
  rate: number; // 0.8 to 1.4
  isMuted: boolean;
  selectedVoiceName?: string;
}

export interface VoiceOption {
  id: string;
  name: string;
  label: string;
  flag: string;
  description: string;
  gender: 'male' | 'female' | 'auto';
}

export const PRESET_VOICE_OPTIONS: VoiceOption[] = [
  {
    id: 'auto',
    name: 'Automatic (Role-Specific)',
    label: '✨ Automatic Personas',
    flag: '🎭',
    description: 'Distinct voices per role (PM, Lead, Dev, QA)',
    gender: 'auto',
  },
  {
    id: 'Daniel',
    name: 'Daniel',
    label: 'Daniel (British Male)',
    flag: '🇬🇧',
    description: 'Classic British, natural & articulate',
    gender: 'male',
  },
  {
    id: 'Rocko (English (US))',
    name: 'Rocko',
    label: 'Rocko (US Male)',
    flag: '🇺🇸',
    description: 'Warm, resonant American male',
    gender: 'male',
  },
  {
    id: 'Eddy (English (US))',
    name: 'Eddy',
    label: 'Eddy (US Male)',
    flag: '🇺🇸',
    description: 'Dynamic, friendly engineer persona',
    gender: 'male',
  },
  {
    id: 'Reed (English (US))',
    name: 'Reed',
    label: 'Reed (US Male)',
    flag: '🇺🇸',
    description: 'Crisp, authoritative QA persona',
    gender: 'male',
  },
  {
    id: 'Alex',
    name: 'Alex',
    label: 'Alex (US Male)',
    flag: '🇺🇸',
    description: 'Standard natural macOS system voice',
    gender: 'male',
  },
  {
    id: 'Fred',
    name: 'Fred',
    label: 'Fred (macOS Classic)',
    flag: '🇺🇸',
    description: 'Classic retro synthesizer male',
    gender: 'male',
  },
  {
    id: 'Ralph',
    name: 'Ralph',
    label: 'Ralph (Deep US Male)',
    flag: '🇺🇸',
    description: 'Deep baritone American male',
    gender: 'male',
  },
  {
    id: 'Rishi',
    name: 'Rishi',
    label: 'Rishi (Indian Male)',
    flag: '🇮🇳',
    description: 'Polished Indian English male',
    gender: 'male',
  },
  {
    id: 'Samantha',
    name: 'Samantha',
    label: 'Samantha (US Female)',
    flag: '🇺🇸',
    description: 'Natural American female voice',
    gender: 'female',
  },
  {
    id: 'Karen',
    name: 'Karen',
    label: 'Karen (Australian Female)',
    flag: '🇦🇺',
    description: 'Natural Australian female voice',
    gender: 'female',
  },
];

const DEFAULT_SETTINGS: OfficeVoiceSettings = {
  voiceAssistantEnabled: true,
  speakHandoffsEnabled: true,
  volume: 1.0,
  rate: 1.0,
  isMuted: false,
  selectedVoiceName: 'auto',
};

// Blacklist old 1990s robotic Mac voices that sound mechanical
const ROBOTIC_VOICE_BLACKLIST = [
  'moira',
  'tessa',
  'karen',
  'fiona',
  'veena',
  'fred',
  'zarvox',
  'trinoids',
  'whisper',
  'bad news',
  'bahh',
  'bells',
  'boing',
  'bubbles',
  'cellos',
  'deranged',
  'good news',
  'hysterical',
  'pipe organ',
];

// Known female voices across macOS, Windows, Google to strictly exclude
const FEMALE_VOICE_NAMES = [
  'ava',
  'samantha',
  'zoe',
  'allison',
  'victoria',
  'susan',
  'karen',
  'tessa',
  'veena',
  'fiona',
  'moira',
  'jenny',
  'aria',
  'female',
  'zira',
  'hazel',
  'stephanie',
  'catherine',
  'helena',
  'elena',
  'serena',
  'yuri',
  'tingting',
  'mei-jia',
  'sin-ji',
];

// Verified male human voices across macOS (Daniel, Oliver, Rocko, Eddy, Reed, Tom, Evan, Alex, Nathan),
// Windows (Guy, Ryan, Christopher, Eric, David), and Google (Google UK English Male, Google US English Male)
const KNOWN_MALE_VOICE_NAMES = [
  'daniel',
  'oliver',
  'alex',
  'tom',
  'evan',
  'nathan',
  'lee',
  'jamie',
  'gordon',
  'rishi',
  'guy',
  'ryan',
  'christopher',
  'eric',
  'david',
  'mark',
  'george',
  'rocko',
  'eddy',
  'reed',
  'male',
];

// All roles configured strictly with distinct, authentic male voices
const ROLE_PROFILES: Record<string, VoiceProfile> = {
  assistant: {
    pitch: 1.0,
    rate: 1.0,
    preferredVoices: [
      'Daniel',
      'Daniel (Enhanced)',
      'Oliver (Enhanced)',
      'Oliver',
      'Alex',
      'Google UK English Male',
      'Google US English Male',
      'Microsoft Ryan Online (Natural)',
      'Microsoft Guy Online (Natural)',
      'en-GB',
      'en-US',
    ],
  },
  pm: {
    pitch: 0.98,
    rate: 1.0,
    preferredVoices: [
      'Rocko (English (US))',
      'Rocko',
      'Tom (Enhanced)',
      'Tom',
      'Evan (Enhanced)',
      'Evan',
      'Alex',
      'Google US English Male',
      'Microsoft Guy Online (Natural)',
      'en-US',
    ],
  },
  lead: {
    pitch: 0.96,
    rate: 0.98,
    preferredVoices: [
      'Daniel',
      'Daniel (Enhanced)',
      'Oliver (Enhanced)',
      'Oliver',
      'Nathan (Enhanced)',
      'Nathan',
      'Alex',
      'Google UK English Male',
      'Microsoft Christopher Online (Natural)',
      'en-GB',
      'en-US',
    ],
  },
  developer: {
    pitch: 0.98,
    rate: 1.0,
    preferredVoices: [
      'Eddy (English (US))',
      'Eddy',
      'Evan (Enhanced)',
      'Evan',
      'Lee (Enhanced)',
      'Lee',
      'Tom (Enhanced)',
      'Tom',
      'Alex',
      'Google US English Male',
      'Microsoft Eric Online (Natural)',
      'en-US',
    ],
  },
  qa: {
    pitch: 0.97,
    rate: 1.0,
    preferredVoices: [
      'Reed (English (US))',
      'Reed (English (UK))',
      'Reed',
      'Gordon',
      'Jamie (Enhanced)',
      'Jamie',
      'Oliver (Enhanced)',
      'Oliver',
      'Tom',
      'Alex',
      'Google UK English Male',
      'Microsoft Ryan Online (Natural)',
      'en-GB',
      'en-US',
    ],
  },
};

class VoiceService {
  private settings: OfficeVoiceSettings = { ...DEFAULT_SETTINGS };
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private voices: SpeechSynthesisVoice[] = [];
  private voicesLoaded: boolean = false;
  private speakingListeners: Array<(isSpeaking: boolean) => void> = [];
  private isCurrentlySpeaking: boolean = false;
  private settingsChangeListeners: Array<(s: OfficeVoiceSettings) => void> = [];
  private currentRequestId: number = 0;
  private currentAbortController: AbortController | null = null;
  private safetyTimer: any = null;

  private clearSafetyTimer() {
    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer);
      this.safetyTimer = null;
    }
  }

  private setSpeaking(speaking: boolean, maxDurationMs: number = 10000) {
    this.isCurrentlySpeaking = speaking;
    this.clearSafetyTimer();
    if (speaking) {
      this.safetyTimer = setTimeout(() => {
        if (this.isCurrentlySpeaking) {
          this.isCurrentlySpeaking = false;
          this.speakingListeners.forEach((fn) => {
            try { fn(false); } catch (e) {}
          });
        }
      }, maxDurationMs);
    }
    this.speakingListeners.forEach((fn) => {
      try { fn(speaking); } catch (e) {}
    });
  }

  public isSpeaking(): boolean {
    return this.isCurrentlySpeaking;
  }

  // Web Audio Graph for direct video recording synchronization
  private audioCtx: AudioContext | null = null;
  private audioDestination: MediaStreamAudioDestinationNode | null = null;
  private currentBufferSource: AudioBufferSourceNode | null = null;

  public getOrCreateAudioDestination(): MediaStreamAudioDestinationNode | null {
    if (typeof window === 'undefined') return null;
    try {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          this.audioCtx = new AudioContextClass();
        }
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      if (this.audioCtx && !this.audioDestination) {
        this.audioDestination = this.audioCtx.createMediaStreamDestination();

        // Keep continuous clock active on audio track so MediaRecorder never drops audio
        try {
          const osc = this.audioCtx.createOscillator();
          const gain = this.audioCtx.createGain();
          gain.gain.value = 0.00001; // inaudible keep-alive
          osc.connect(gain);
          gain.connect(this.audioDestination);
          osc.start();
        } catch (e) {}
      }
      return this.audioDestination;
    } catch (e) {
      return null;
    }
  }

  public getAudioStreamTrack(): MediaStreamTrack | null {
    try {
      const dest = this.getOrCreateAudioDestination();
      if (!dest) return null;
      const tracks = dest.stream.getAudioTracks();
      return tracks.length > 0 ? tracks[0] : null;
    } catch (e) {
      return null;
    }
  }

  constructor() {
    this.loadSettings();

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.loadVoices();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = () => this.loadVoices();
      }
    }
  }

  private loadSettings() {
    try {
      const saved = localStorage.getItem('virtual_office_voice_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        this.settings = { ...DEFAULT_SETTINGS, ...parsed };
      } else {
        const legacyMuted = localStorage.getItem('virtual_office_muted');
        if (legacyMuted !== null) {
          this.settings.isMuted = legacyMuted === 'true';
        }
      }
    } catch (e) {
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  public getSettings(): OfficeVoiceSettings {
    return { ...this.settings };
  }

  public updateSettings(partial: Partial<OfficeVoiceSettings>) {
    this.settings = { ...this.settings, ...partial };
    try {
      localStorage.setItem('virtual_office_voice_settings', JSON.stringify(this.settings));
    } catch (e) {}

    if (this.settings.isMuted) {
      this.stop();
    }

    this.settingsChangeListeners.forEach((fn) => fn(this.getSettings()));
  }

  public onSettingsChange(fn: (s: OfficeVoiceSettings) => void) {
    this.settingsChangeListeners.push(fn);
    return () => {
      this.settingsChangeListeners = this.settingsChangeListeners.filter((l) => l !== fn);
    };
  }

  private loadVoices() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    this.voices = window.speechSynthesis.getVoices();
    if (this.voices.length > 0) {
      this.voicesLoaded = true;
    }
  }

  public getAvailableHumanVoices(): SpeechSynthesisVoice[] {
    if (this.voices.length === 0) {
      this.loadVoices();
    }
    // Only accept genuine human male voices. Exclude all robotic synthesizers and female voices.
    return this.voices.filter((v) => {
      const lower = v.name.toLowerCase();
      const isEnglish = v.lang.toLowerCase().startsWith('en');
      if (!isEnglish) return false;

      if (ROBOTIC_VOICE_BLACKLIST.some((b) => lower.includes(b))) return false;
      if (FEMALE_VOICE_NAMES.some((f) => lower.includes(f))) return false;

      const isKnownMale = KNOWN_MALE_VOICE_NAMES.some((m) => lower.includes(m));
      const isNeuralOrNatural =
        lower.includes('google') ||
        lower.includes('natural') ||
        lower.includes('neural') ||
        lower.includes('online') ||
        lower.includes('siri') ||
        lower.includes('premium') ||
        lower.includes('enhanced') ||
        lower.includes('studio');

      return isKnownMale || isNeuralOrNatural;
    });
  }

  public getMuted(): boolean {
    return this.settings.isMuted;
  }

  public toggleMute(): boolean {
    const nextMuted = !this.settings.isMuted;
    this.updateSettings({ isMuted: nextMuted });
    return nextMuted;
  }

  public isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  public isRecognitionSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)
    );
  }

  public getPresetVoiceOptions(): VoiceOption[] {
    return PRESET_VOICE_OPTIONS;
  }

  /**
   * Find best available voice, respecting user explicit selection
   */
  private pickVoice(preferred: string[]): SpeechSynthesisVoice | null {
    if (this.voices.length === 0) {
      this.loadVoices();
    }

    const cleanVoices = this.getAvailableHumanVoices();

    // 0. If user explicitly selected a voice in settings
    if (this.settings.selectedVoiceName && this.settings.selectedVoiceName !== 'auto') {
      const explicitMatch =
        this.voices.find((v) => v.name.toLowerCase() === this.settings.selectedVoiceName!.toLowerCase()) ||
        this.voices.find((v) => v.name.toLowerCase().includes(this.settings.selectedVoiceName!.toLowerCase())) ||
        cleanVoices.find((v) => v.name === this.settings.selectedVoiceName);
      if (explicitMatch) return explicitMatch;
    }

    // 1. Try finding enhanced/premium human male voices first (Daniel, Oliver, Rocko, Eddy, Reed, Tom)
    for (const name of preferred) {
      const enhancedMatch = cleanVoices.find(
        (v) =>
          v.name.toLowerCase().includes(name.toLowerCase()) &&
          (v.name.toLowerCase().includes('enhanced') ||
            v.name.toLowerCase().includes('premium') ||
            v.name.toLowerCase().includes('natural') ||
            v.name.toLowerCase().includes('siri'))
      );
      if (enhancedMatch) return enhancedMatch;
    }

    // 2. Normal preferred male voice match
    for (const name of preferred) {
      const match = cleanVoices.find(
        (v) =>
          v.name.toLowerCase().includes(name.toLowerCase()) ||
          v.lang.toLowerCase().startsWith(name.toLowerCase())
      );
      if (match) return match;
    }

    // 3. Fallback to Alex or any known male voice
    const alexVoice = cleanVoices.find((v) => v.name.toLowerCase().includes('alex'));
    if (alexVoice) return alexVoice;

    const anyMale = cleanVoices.find((v) => KNOWN_MALE_VOICE_NAMES.some((m) => v.name.toLowerCase().includes(m)));
    if (anyMale) return anyMale;

    // 4. Return clean verified male voice or first non-female voice
    return cleanVoices[0] || this.voices.find((v) => v.name.toLowerCase().includes('alex')) || null;
  }

  /**
   * Speaks text using a specific persona
   */
  public async speak(
    text: string,
    role: 'assistant' | 'pm' | 'lead' | 'developer' | 'qa' = 'assistant',
    onEnd?: () => void
  ): Promise<void> {
    if (this.settings.isMuted || !this.settings.voiceAssistantEnabled) {
      if (onEnd) onEnd();
      return;
    }

    this.stop();

    const reqId = ++this.currentRequestId;
    this.currentAbortController = new AbortController();
    const abortSignal = this.currentAbortController.signal;

    // Natural text clean-up: clean symbols, preserve short acronyms/badges (PM, QA, etc.)
    const cleanText = text
      .replace(/[*_#`~>]/g, '')
      .replace(/\b(\w+)\.kt\b/gi, '$1 Kotlin file')
      .replace(/\b(\w+)\.ts\b/gi, '$1 TypeScript file')
      .replace(/\bPR\b/g, 'Pull Request')
      .replace(/\bDoD\b/g, 'Definition of Done')
      .replace(/https?:\/\/\S+/g, 'link');

    const activeVoice =
      this.settings.selectedVoiceName && this.settings.selectedVoiceName !== 'auto'
        ? this.settings.selectedVoiceName
        : role;

    // 1. Try server-side natural male TTS with Web Audio API (native macOS say -> recordable into video!)
    try {
      const dest = this.getOrCreateAudioDestination();
      if (this.audioCtx) {
        const encodedText = encodeURIComponent(cleanText);
        const voiceParam = encodeURIComponent(activeVoice);
        const resp = await fetch(`/api/tts?text=${encodedText}&voice=${voiceParam}`, {
          signal: abortSignal,
        });

        if (reqId !== this.currentRequestId) return;

        if (resp.ok) {
          const arrayBuffer = await resp.arrayBuffer();
          if (reqId !== this.currentRequestId) return;

          const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
          if (reqId !== this.currentRequestId) return;

          const source = this.audioCtx.createBufferSource();
          source.buffer = audioBuffer;

          // Connect to speakers AND recording destination
          source.connect(this.audioCtx.destination);
          if (dest) {
            source.connect(dest);
          }

          this.currentBufferSource = source;
          const durationMs = Math.min(25000, Math.max(3000, Math.ceil((audioBuffer.duration + 0.6) * 1000)));
          this.setSpeaking(true, durationMs);

          source.onended = () => {
            if (this.currentBufferSource === source) {
              this.clearSafetyTimer();
              this.setSpeaking(false);
              this.currentBufferSource = null;
            }
            if (onEnd) onEnd();
          };

          source.start(0);
          return;
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || reqId !== this.currentRequestId) {
        return;
      }
      console.warn('[VoiceService] Server native male TTS error, using Web Speech API fallback:', err);
    }

    if (reqId !== this.currentRequestId) return;

    // 2. Fallback to native Web Speech API if server TTS is unreachable
    if (!this.isSupported()) {
      if (onEnd) onEnd();
      return;
    }

    return new Promise((resolve) => {
      if (reqId !== this.currentRequestId) {
        if (onEnd) onEnd();
        resolve();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(cleanText);
      const profile = ROLE_PROFILES[role] || ROLE_PROFILES.assistant;

      // Natural Human Cadence: native 1.0 pitch preserves acoustic warmth
      utterance.pitch = profile.pitch;
      utterance.rate = this.settings.rate || 1.0;
      utterance.volume = this.settings.volume;

      const voice = this.pickVoice(profile.preferredVoices);
      if (voice) {
        utterance.voice = voice;
      }

      utterance.onstart = () => {
        if (reqId === this.currentRequestId) {
          const estDuration = Math.min(20000, Math.max(3000, cleanText.split(/\s+/).length * 600));
          this.setSpeaking(true, estDuration);
        }
      };

      utterance.onend = () => {
        if (reqId === this.currentRequestId) {
          this.clearSafetyTimer();
          this.setSpeaking(false);
          this.currentUtterance = null;
        }
        if (onEnd) onEnd();
        resolve();
      };

      utterance.onerror = () => {
        if (reqId === this.currentRequestId) {
          this.clearSafetyTimer();
          this.setSpeaking(false);
          this.currentUtterance = null;
        }
        if (onEnd) onEnd();
        resolve();
      };

      this.currentUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    });
  }

  /**
   * Helper to resolve the short badge identifier (e.g. "PM", "LEAD", "DEV", "QA")
   */
  public getShortBadge(badge?: string, role?: string, name?: string): string {
    const rawBadge = (badge || '').trim();
    if (rawBadge && rawBadge.length > 0 && rawBadge.length <= 6) {
      return rawBadge.toUpperCase();
    }
    const combined = `${rawBadge} ${role || ''} ${name || ''}`.toLowerCase();
    if (combined.match(/\bpm\b|product lead|product manager|delivery lead|scrum master|manager/)) return 'PM';
    if (combined.match(/\bscrum\b|agile coach/)) return 'SM';
    if (combined.match(/\blead\b|architect|tech lead|system architect/)) return 'LEAD';
    if (combined.match(/\bdevops\b|infra|sre/)) return 'OPS';
    if (combined.match(/\bsecurity\b|compliance/)) return 'SEC';
    if (combined.match(/\bdesign\b|ux|ui/)) return 'DES';
    if (combined.match(/\bdata\b|scientist|ai researcher/)) return 'DS';
    if (combined.match(/\bdoc\b|writer|technical writer/)) return 'DOC';
    if (combined.match(/\bdev\b|developer|frontend|backend|feature engineer|core developer|engineer/)) return 'DEV';
    if (combined.match(/\bqa\b|tester|test automation|qa specialist|quality assurance/)) return 'QA';
    if (rawBadge) return rawBadge.slice(0, 4).toUpperCase();
    if (name && name.trim()) return name.trim().split(/\s+/)[0].slice(0, 4).toUpperCase();
    return 'AGT';
  }

  /**
   * Speaks when an agent assigns/delegates a task to another agent.
   * Announces with short badge labels: e.g. "PM is assigning Architecture Spike to LEAD."
   * (Commented out for now per user request)
   */
  public speakHandoff(
    _fromName: string,
    _fromRole: string,
    _toName: string,
    _toRoleOrTask: string,
    _maybeTaskTitle?: string,
    _fromBadge?: string,
    _toBadge?: string
  ) {
    /* Handover voice functionality commented out for now
    if (!this.settings.speakHandoffsEnabled || this.settings.isMuted) return;

    let toRole = toRoleOrTask;
    let taskTitle = maybeTaskTitle || '';

    // Backwards compatibility if called with 4 args: (fromName, fromRole, toName, taskTitle)
    if (!maybeTaskTitle) {
      taskTitle = toRoleOrTask;
      toRole = '';
    }

    const roleKey =
      fromRole.toLowerCase().includes('manager') || fromRole.toLowerCase().includes('scrum') || fromRole.toLowerCase().includes('pm')
        ? 'pm'
        : fromRole.toLowerCase().includes('lead') || fromRole.toLowerCase().includes('architect')
        ? 'lead'
        : fromRole.toLowerCase().includes('dev') || fromRole.toLowerCase().includes('engineer') || fromRole.toLowerCase().includes('builder')
        ? 'developer'
        : 'qa';

    const cleanTitle = taskTitle
      .replace(/US-\d+:?|TASK-\d+:?/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Just name the badge as its short
    const fromShort = this.getShortBadge(fromBadge, fromRole, fromName);
    const toShort = this.getShortBadge(toBadge, toRole, toName);

    const message = `${fromShort} is assigning ${cleanTitle} to ${toShort}.`;
    this.speak(message, roleKey as any);
    */
  }

  public onSpeakingChange(cb: (isSpeaking: boolean) => void): () => void {
    this.speakingListeners.push(cb);
    // Call immediately with current state
    try {
      cb(this.isCurrentlySpeaking);
    } catch (e) {}
    return () => {
      this.speakingListeners = this.speakingListeners.filter((l) => l !== cb);
    };
  }

  public stop() {
    this.currentRequestId++;
    this.clearSafetyTimer();
    if (this.currentAbortController) {
      try {
        this.currentAbortController.abort();
      } catch (e) {}
      this.currentAbortController = null;
    }
    if (this.currentBufferSource) {
      try {
        this.currentBufferSource.stop();
      } catch (e) {}
      this.currentBufferSource = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
      this.currentUtterance = null;
    }
    this.setSpeaking(false);
  }

  /**
   * Creates a Web Speech Recognition listener
   */
  public createRecognition(
    onResult: (transcript: string, isFinal: boolean) => void,
    onError: (err: any) => void,
    onEnd: () => void
  ): any {
    if (!this.isRecognitionSupported()) return null;

    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRec();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      if (final) {
        onResult(final.trim(), true);
      } else if (interim) {
        onResult(interim.trim(), false);
      }
    };

    recognition.onerror = (e: any) => {
      onError(e);
    };

    recognition.onend = () => {
      onEnd();
    };

    return recognition;
  }
}

export const voiceService = new VoiceService();
