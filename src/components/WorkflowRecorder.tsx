import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Video, Square, Download, X, Sparkles, Loader2, Monitor, Layers } from 'lucide-react';
import { voiceService } from '../services/voiceService';

export interface WorkflowRecorderProps {
  canvasElement: HTMLCanvasElement | null;
  isTerminalGrid?: boolean;
  onRecordingStateChange?: (isRecording: boolean, seconds: number) => void;
}

export const WorkflowRecorder: React.FC<WorkflowRecorderProps> = ({
  canvasElement,
  isTerminalGrid = false,
  onRecordingStateChange,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedMp4Url, setRecordedMp4Url] = useState<string | null>(null);
  const [recordedMp4Blob, setRecordedMp4Blob] = useState<Blob | null>(null);
  const [isConvertingMp4, setIsConvertingMp4] = useState<boolean>(false);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showSourceModal, setShowSourceModal] = useState(false);
  const [captureMode, setCaptureMode] = useState<'canvas' | 'screen'>(
    isTerminalGrid || !canvasElement ? 'screen' : 'canvas'
  );

  useEffect(() => {
    if (isTerminalGrid || !canvasElement) {
      setCaptureMode('screen');
    } else {
      setCaptureMode('canvas');
    }
  }, [isTerminalGrid, canvasElement]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceTracksRef = useRef<MediaStreamTrack[]>([]);

  const cleanUpTracksAndAudio = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (_) {}
      });
      streamRef.current = null;
    }
    sourceTracksRef.current.forEach((track) => {
      try {
        track.stop();
      } catch (_) {}
    });
    sourceTracksRef.current = [];

    if (audioContextRef.current) {
      try {
        if (audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close().catch(() => {});
        }
      } catch (_) {}
      audioContextRef.current = null;
    }
  }, []);

  // Clean up timer and media streams on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      cleanUpTracksAndAudio();
    };
  }, [cleanUpTracksAndAudio]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getBestMimeType = () => {
    // 1. Check if browser natively supports MP4 recording
    const mp4Types = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1',
      'video/mp4;codecs=h264',
      'video/mp4',
    ];
    for (const t of mp4Types) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) {
        return { mimeType: t, isNativeMp4: true };
      }
    }
    // 2. Otherwise record WebM and convert automatically to MP4 via server ffmpeg
    const webmTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    for (const t of webmTypes) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) {
        return { mimeType: t, isNativeMp4: false };
      }
    }
    return { mimeType: 'video/webm', isNativeMp4: false };
  };

  const triggerDownload = (url: string, extension: 'mp4' | 'webm') => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-virtual-office-workflow-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (_) {}
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    setIsRecording(false);
    if (onRecordingStateChange) onRecordingStateChange(false, recordingSeconds);
  }, [onRecordingStateChange, recordingSeconds]);

  const initRecorderWithStream = (stream: MediaStream) => {
    recordedChunksRef.current = [];
    setRecordedMp4Blob(null);
    setRecordedMp4Url(null);
    setConversionError(null);

    const { mimeType, isNativeMp4 } = getBestMimeType();

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 8000000, // High quality 8 Mbps video
      audioBitsPerSecond: 128000,  // 128 kbps crisp voice audio
    });

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunksRef.current.push(event.data);
      }
    };

    recorder.onstop = async () => {
      const rawBlob = new Blob(recordedChunksRef.current, { type: mimeType });
      const rawUrl = URL.createObjectURL(rawBlob);
      setRecordedBlob(rawBlob);
      setRecordedVideoUrl(rawUrl);
      setShowPreviewModal(true);

      // Clean up stream tracks and web audio context
      cleanUpTracksAndAudio();

      // If recorded natively as MP4, download directly!
      if (isNativeMp4) {
        setRecordedMp4Blob(rawBlob);
        setRecordedMp4Url(rawUrl);
        triggerDownload(rawUrl, 'mp4');
        return;
      }

      // Convert WebM to Universal MP4 (H.264/AAC for QuickTime, Mac, Windows, Mobile)
      setIsConvertingMp4(true);
      try {
        const response = await fetch('/api/convert-to-mp4', {
          method: 'POST',
          headers: { 'Content-Type': mimeType },
          body: rawBlob,
        });

        if (response.ok) {
          const mp4Blob = await response.blob();
          const mp4Url = URL.createObjectURL(mp4Blob);
          setRecordedMp4Blob(mp4Blob);
          setRecordedMp4Url(mp4Url);
          setIsConvertingMp4(false);

          // Automatically download MP4 so it opens in QuickTime immediately
          triggerDownload(mp4Url, 'mp4');
        } else {
          console.warn('Server MP4 conversion returned non-ok status, falling back to WebM.');
          setIsConvertingMp4(false);
          setConversionError('FFmpeg conversion unavailable. Saved as WebM.');
          triggerDownload(rawUrl, 'webm');
        }
      } catch (err: any) {
        console.warn('MP4 conversion fetch failed, fallback to WebM:', err);
        setIsConvertingMp4(false);
        setConversionError('Network issue during MP4 conversion. Saved as WebM.');
        triggerDownload(rawUrl, 'webm');
      }
    };

    recorder.start(500); // 500ms time slice
    mediaRecorderRef.current = recorder;
    setIsRecording(true);
    setRecordingSeconds(0);

    if (onRecordingStateChange) onRecordingStateChange(true, 0);

    timerIntervalRef.current = setInterval(() => {
      setRecordingSeconds((prev) => {
        const next = prev + 1;
        if (onRecordingStateChange) onRecordingStateChange(true, next);
        return next;
      });
    }, 1000);
  };

  const startCanvasRecording = () => {
    if (!canvasElement) {
      alert('Agent Command Center canvas is initializing. Please try in a moment.');
      return;
    }

    try {
      // 60 FPS smooth capture directly from Agent Command Center canvas
      const canvasStream = (canvasElement as any).captureStream ? (canvasElement as any).captureStream(60) : null;
      if (!canvasStream) {
        alert('Canvas recording is not supported in this browser version.');
        return;
      }

      // Create combined stream containing both video frames and agent voice audio
      const combinedStream = new MediaStream();

      // 1. Add canvas 60fps video tracks
      canvasStream.getVideoTracks().forEach((track: MediaStreamTrack) => {
        combinedStream.addTrack(track);
      });
      sourceTracksRef.current = [...canvasStream.getTracks()];

      // 2. Add real-time agent voice audio track from VoiceService
      const audioTrack = voiceService.getAudioStreamTrack();
      if (audioTrack) {
        combinedStream.addTrack(audioTrack);
        sourceTracksRef.current.push(audioTrack);
      }

      streamRef.current = combinedStream;
      initRecorderWithStream(combinedStream);
    } catch (e: any) {
      console.error('Failed to capture canvas stream:', e);
      alert(`Could not start canvas recording: ${e.message}`);
      cleanUpTracksAndAudio();
    }
  };

  const startScreenRecording = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        alert('Screen and browser tab recording is not supported in this browser.');
        return;
      }

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 60 },
        audio: true,
      });

      const videoTrack = displayStream.getVideoTracks()[0];
      if (!videoTrack) {
        displayStream.getTracks().forEach((t) => t.stop());
        return;
      }

      sourceTracksRef.current = [...displayStream.getTracks()];

      // Create combined stream
      const combinedStream = new MediaStream();
      combinedStream.addTrack(videoTrack);

      // Listen to native "Stop sharing" event from browser chrome
      videoTrack.onended = () => {
        stopRecording();
      };

      // Audio track merging: combine display tab audio with agent voice audio
      const displayAudioTracks = displayStream.getAudioTracks();
      const voiceAudioTrack = voiceService.getAudioStreamTrack();

      if (voiceAudioTrack) {
        sourceTracksRef.current.push(voiceAudioTrack);
      }

      if (displayAudioTracks.length > 0 || voiceAudioTrack) {
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (AudioContextClass) {
            const audioCtx = new AudioContextClass();
            audioContextRef.current = audioCtx;
            const dest = audioCtx.createMediaStreamDestination();

            if (displayAudioTracks.length > 0) {
              const tabStream = new MediaStream([displayAudioTracks[0]]);
              const tabSource = audioCtx.createMediaStreamSource(tabStream);
              tabSource.connect(dest);
            }

            if (voiceAudioTrack) {
              const voiceStream = new MediaStream([voiceAudioTrack]);
              const voiceSource = audioCtx.createMediaStreamSource(voiceStream);
              voiceSource.connect(dest);
            }

            const mixedTrack = dest.stream.getAudioTracks()[0];
            if (mixedTrack) {
              combinedStream.addTrack(mixedTrack);
            }
          } else if (displayAudioTracks.length > 0) {
            combinedStream.addTrack(displayAudioTracks[0]);
          } else if (voiceAudioTrack) {
            combinedStream.addTrack(voiceAudioTrack);
          }
        } catch (audioErr) {
          console.warn('Audio mixing error, using fallback audio tracks:', audioErr);
          if (displayAudioTracks.length > 0) {
            combinedStream.addTrack(displayAudioTracks[0]);
          } else if (voiceAudioTrack) {
            combinedStream.addTrack(voiceAudioTrack);
          }
        }
      }

      streamRef.current = combinedStream;
      initRecorderWithStream(combinedStream);
    } catch (err: any) {
      if (err.name !== 'NotAllowedError') {
        console.error('Failed to start screen recording:', err);
        alert(`Could not start screen/tab recording: ${err.message}`);
      }
      cleanUpTracksAndAudio();
    }
  };

  const handleDownloadMp4 = () => {
    if (recordedMp4Url) {
      triggerDownload(recordedMp4Url, 'mp4');
    } else if (recordedVideoUrl && !isConvertingMp4) {
      triggerDownload(recordedVideoUrl, 'webm');
    }
  };

  const handleDownloadWebm = () => {
    if (recordedVideoUrl) {
      triggerDownload(recordedVideoUrl, 'webm');
    }
  };

  return (
    <>
      {/* Recording Control Button in Header / Toolbar */}
      <div className="relative inline-flex items-center">
        {!isRecording ? (
          <button
            type="button"
            onClick={() => setShowSourceModal(true)}
            title="Record Workflow"
            aria-label="Record workflow"
            className="flex items-center justify-center gap-1.5 w-10 h-10 md:w-auto md:h-auto px-0 md:px-3 py-0 md:py-1.5 rounded-xl bg-surface border border-sand-200/90 hover:bg-sand-50 text-xs font-bold text-sand-700 hover:text-sand-900 transition-all shadow-xs active:scale-95 cursor-pointer"
          >
            <Video className="w-3.5 h-3.5 text-rose-600" aria-hidden="true" />
            <span className="hidden xl:inline">Record Workflow</span>
          </button>
        ) : (
          /* Active Recording State Button with Live Timer */
          <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-xl pl-2.5 pr-0 md:px-3 py-0 md:py-1.5 shadow-sm">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-pulse shrink-0" />
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-black text-rose-700 font-mono">
                REC {formatTime(recordingSeconds)}
              </span>
            </div>

            <button
              type="button"
              onClick={stopRecording}
              aria-label="Stop and save recording"
              className="md:ml-2 flex items-center justify-center gap-1.5 w-10 h-10 md:w-auto md:h-auto md:px-2.5 md:py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-all shadow-xs active:scale-95 cursor-pointer"
            >
              <Square className="w-3 h-3 fill-current" aria-hidden="true" />
              <span className="hidden xl:inline">Stop & Save</span>
            </button>
          </div>
        )}
      </div>

      {/* Recording Source Selection Modal (Rendered via Portal into document.body to escape Header backdrop-filter clipping) */}
      {showSourceModal &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] bg-scrim/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
            onClick={() => setShowSourceModal(false)}
          >
            <div
              className="bg-surface rounded-3xl border border-sand-200 shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 my-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-sand-100 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center shadow-xs shrink-0">
                    <Video className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-sand-900">Choose Recording Source</h3>
                    <p className="text-xs text-sand-500">
                      Select how you would like to capture your agent workflow session
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setShowSourceModal(false)}
                  className="w-8 h-8 rounded-lg hover:bg-sand-100 flex items-center justify-center text-sand-400 hover:text-sand-600 transition-colors cursor-pointer shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Options */}
              <div className="p-6 space-y-3.5 bg-sand-50/50 overflow-y-auto flex-1">
                {/* Option A: Virtual Office 2D Canvas (60 FPS) */}
                <button
                  type="button"
                  onClick={() => {
                    setShowSourceModal(false);
                    startCanvasRecording();
                  }}
                  disabled={!canvasElement}
                  className={`w-full p-4 rounded-2xl border text-left transition-all flex items-start gap-4 cursor-pointer group ${
                    canvasElement
                      ? 'bg-surface hover:bg-brand-50/50 border-sand-200 hover:border-brand-300 shadow-xs hover:shadow-md'
                      : 'bg-sand-100 border-sand-200 opacity-60 cursor-not-allowed'
                  }`}
                >
                  <div className="w-10 h-10 rounded-xl bg-brand-50 border border-brand-200 text-brand-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                    <Layers className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-sand-900 group-hover:text-brand-900">
                        Agent Command Center 2D Canvas (60 FPS)
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200 shrink-0">
                        Option A
                      </span>
                    </div>
                    <p className="text-xs text-sand-500 mt-1 leading-relaxed">
                      Direct hardware canvas capture of the 2D floor plan, character movements, speech bubbles, and real-time agent voice audio.
                    </p>
                  </div>
                </button>

                {/* Option B: Active Browser Tab / Screen (60 FPS) */}
                <button
                  type="button"
                  onClick={() => {
                    setShowSourceModal(false);
                    startScreenRecording();
                  }}
                  className="w-full p-4 rounded-2xl bg-surface hover:bg-brand-50/50 border border-sand-200 hover:border-brand-300 shadow-xs hover:shadow-md text-left transition-all flex items-start gap-4 cursor-pointer group"
                >
                  <div className="w-10 h-10 rounded-xl bg-sky-50 border border-sky-200 text-sky-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                    <Monitor className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-sand-900 group-hover:text-sky-900">
                        Active Browser Tab / Screen (60 FPS)
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 shrink-0">
                        Option B
                      </span>
                    </div>
                    <p className="text-xs text-sand-500 mt-1 leading-relaxed">
                      Captures your entire browser window, terminal grid, code diffs, logs, and workstation tiles with synchronized voice audio.
                    </p>
                  </div>
                </button>
              </div>

              {/* Modal Footer */}
              <div className="p-4 bg-sand-50 border-t border-sand-100 flex justify-end shrink-0">
                <button
                  onClick={() => setShowSourceModal(false)}
                  className="px-4 py-2 rounded-xl bg-sand-200 hover:bg-sand-300 text-sand-700 text-xs font-bold transition-all cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Video Preview & Sharing Modal (Rendered via Portal into document.body) */}
      {showPreviewModal &&
        recordedVideoUrl &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] bg-scrim/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
            onClick={() => setShowPreviewModal(false)}
          >
            <div
              className="bg-surface rounded-3xl border border-sand-200 shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 space-y-0 my-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-sand-100 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center shadow-xs shrink-0">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-sand-900">Workflow Video Ready!</h3>
                    <p className="text-xs text-sand-500">
                      Your agent workflow session has been recorded and downloaded to your computer.
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setShowPreviewModal(false)}
                  className="w-8 h-8 rounded-lg hover:bg-sand-100 flex items-center justify-center text-sand-400 hover:text-sand-600 transition-colors shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Video Player */}
              <div className="theme-static p-6 bg-sand-950 flex flex-col items-center justify-center relative overflow-y-auto flex-1">
                <video
                  src={recordedMp4Url || recordedVideoUrl || undefined}
                  controls
                  autoPlay
                  className="w-full max-h-[380px] rounded-xl border border-sand-800 shadow-lg object-contain bg-black"
                />

                {/* MP4 Conversion Overlay Banner */}
                {isConvertingMp4 && (
                  <div className="theme-static absolute bottom-10 left-1/2 -translate-x-1/2 bg-sand-900/95 border border-brand-500/50 text-white px-4 py-2 rounded-2xl shadow-2xl flex items-center gap-3 backdrop-blur-md">
                    <Loader2 className="w-4 h-4 text-brand-400 animate-spin shrink-0" />
                    <div className="text-xs">
                      <span className="font-bold text-brand-200">Processing MP4...</span>
                      <span className="text-sand-400 ml-1.5 hidden sm:inline">Optimizing for QuickTime, Mac & mobile</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer / Actions */}
              <div className="p-5 bg-sand-50 flex flex-wrap items-center justify-between gap-3 border-t border-sand-100 shrink-0">
                <div className="flex items-center gap-2 text-xs font-medium">
                  {isConvertingMp4 ? (
                    <div className="flex items-center gap-2 text-brand-600">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Converting to universal MP4 format...</span>
                    </div>
                  ) : recordedMp4Url ? (
                    <div className="flex items-center gap-2 text-emerald-700">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
                      <span className="font-bold">Format: MP4 (H.264 / QuickTime & Universal)</span>
                      {recordedMp4Blob && (
                        <span className="font-mono text-sand-400">
                          ({(recordedMp4Blob.size / 1024 / 1024).toFixed(1)} MB)
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sand-500">
                      <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0"></span>
                      <span>Format: WebM High-Definition</span>
                      {recordedBlob && (
                        <span className="font-mono text-sand-400">
                          ({(recordedBlob.size / 1024 / 1024).toFixed(1)} MB)
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2.5">
                  {/* Secondary WebM Download (if user specifically wants raw WebM) */}
                  {recordedVideoUrl && (
                    <button
                      onClick={handleDownloadWebm}
                      title="Download raw WebM video file"
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface border border-sand-200 text-xs font-bold text-sand-600 hover:text-sand-900 hover:bg-sand-100 transition-all shadow-xs cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 text-sand-500" />
                      <span>WebM</span>
                    </button>
                  )}

                  {/* Primary MP4 Download Button */}
                  <button
                    onClick={handleDownloadMp4}
                    disabled={isConvertingMp4}
                    title="Download QuickTime & Windows compatible MP4 video"
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer ${
                      isConvertingMp4
                        ? 'bg-brand-300 text-white cursor-wait'
                        : 'bg-brand-600 hover:bg-brand-700 text-white shadow-brand-600/20 active:scale-95'
                    }`}
                  >
                    {isConvertingMp4 ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Converting MP4...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5 text-white" />
                        <span>Download MP4</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => setShowPreviewModal(false)}
                    className="px-3.5 py-2 rounded-xl bg-sand-200 hover:bg-sand-300 text-sand-700 text-xs font-bold transition-all cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
