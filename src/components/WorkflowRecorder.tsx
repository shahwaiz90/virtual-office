import React, { useState, useEffect, useRef } from 'react';
import { Video, Square, Download, Play, X, Share2, Monitor, Layers, Sparkles, Check } from 'lucide-react';

interface WorkflowRecorderProps {
  canvasElement: HTMLCanvasElement | null;
  onRecordingStateChange?: (isRecording: boolean, seconds: number) => void;
}

export const WorkflowRecorder: React.FC<WorkflowRecorderProps> = ({
  canvasElement,
  onRecordingStateChange,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingMode, setRecordingMode] = useState<'canvas' | 'screen'>('canvas');
  const [showOptionsDropdown, setShowOptionsDropdown] = useState(false);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getBestMimeType = () => {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) {
        return t;
      }
    }
    return 'video/webm';
  };

  const startCanvasRecording = () => {
    if (!canvasElement) {
      alert('Virtual Office canvas is initializing. Please try in a moment.');
      return;
    }

    try {
      // 60 FPS smooth capture directly from Virtual Office canvas
      const stream = (canvasElement as any).captureStream ? (canvasElement as any).captureStream(60) : null;
      if (!stream) {
        alert('Canvas recording is not supported in this browser version. Try Full Screen mode.');
        return;
      }
      streamRef.current = stream;
      setRecordingMode('canvas');
      initRecorderWithStream(stream);
    } catch (e: any) {
      console.error('Failed to capture canvas stream:', e);
      alert(`Could not start canvas recording: ${e.message}`);
    }
  };

  const startScreenRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser',
          frameRate: { ideal: 60, max: 60 },
        },
        audio: true,
      });
      streamRef.current = stream;
      setRecordingMode('screen');

      // Stop recording if user clicks browser's native "Stop sharing" bar
      stream.getVideoTracks()[0].onended = () => {
        stopRecording();
      };

      initRecorderWithStream(stream);
    } catch (e: any) {
      console.warn('Screen recording cancelled or denied:', e);
    }
  };

  const initRecorderWithStream = (stream: MediaStream) => {
    recordedChunksRef.current = [];
    const mimeType = getBestMimeType();

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 8000000, // High quality 8 Mbps
    });

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      setRecordedBlob(blob);
      setRecordedVideoUrl(url);
      setShowPreviewModal(true);

      // Trigger automatic video file download
      const a = document.createElement('a');
      a.href = url;
      a.download = `agent-virtual-office-workflow-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Clean up stream tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };

    recorder.start(500); // 500ms time slice
    mediaRecorderRef.current = recorder;
    setIsRecording(true);
    setRecordingSeconds(0);
    setShowOptionsDropdown(false);

    if (onRecordingStateChange) onRecordingStateChange(true, 0);

    timerIntervalRef.current = setInterval(() => {
      setRecordingSeconds((prev) => {
        const next = prev + 1;
        if (onRecordingStateChange) onRecordingStateChange(true, next);
        return next;
      });
    }, 1000);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    setIsRecording(false);
    if (onRecordingStateChange) onRecordingStateChange(false, recordingSeconds);
  };

  const handleDownloadAgain = () => {
    if (!recordedVideoUrl) return;
    const a = document.createElement('a');
    a.href = recordedVideoUrl;
    a.download = `agent-virtual-office-workflow-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <>
      {/* Recording Control Button in Header / Toolbar */}
      <div className="relative inline-flex items-center">
        {!isRecording ? (
          <div className="flex items-center">
            <button
              onClick={() => setShowOptionsDropdown((prev) => !prev)}
              title="Record virtual office workflow and share as video"
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200/90 transition-all shadow-xs hover:border-slate-300 active:scale-95 cursor-pointer"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
              <Video className="w-3.5 h-3.5 text-rose-600" />
              <span>Record Workflow</span>
            </button>

            {/* Dropdown for Recording Choice */}
            {showOptionsDropdown && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-2xl border border-slate-200/90 shadow-xl p-2 z-50 animate-in fade-in zoom-in-95 space-y-1">
                <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  Select Video Capture Mode
                </div>

                <button
                  onClick={startCanvasRecording}
                  className="w-full text-left p-2.5 rounded-xl hover:bg-indigo-50/80 transition-colors flex items-start gap-3 cursor-pointer group"
                >
                  <div className="w-8 h-8 rounded-lg bg-indigo-100/70 text-indigo-700 flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-indigo-200/70">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                      <span>Virtual Office Canvas (60 FPS)</span>
                      <span className="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.2 rounded-full">
                        Instant
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Captures character walking, animated handoffs, and workstations directly without permission popups.
                    </p>
                  </div>
                </button>

                <button
                  onClick={startScreenRecording}
                  className="w-full text-left p-2.5 rounded-xl hover:bg-indigo-50/80 transition-colors flex items-start gap-3 cursor-pointer group"
                >
                  <div className="w-8 h-8 rounded-lg bg-blue-100/70 text-blue-700 flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-blue-200/70">
                    <Monitor className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-extrabold text-slate-900">
                      Entire Dashboard Tab
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Captures everything: Virtual Office + Kanban Task Board + File Changes + Live Logs.
                    </p>
                  </div>
                </button>
              </div>
            )}
          </div>
        ) : (
          /* Active Recording State Button with Live Timer */
          <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-xl px-3 py-1.5 shadow-sm">
            <span className="w-3 h-3 rounded-full bg-rose-600 animate-ping shrink-0" />
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-black text-rose-700 font-mono">
                REC {formatTime(recordingSeconds)}
              </span>
              <span className="text-[10px] text-rose-500 font-semibold uppercase hidden sm:inline">
                ({recordingMode === 'canvas' ? 'Canvas' : 'Screen'})
              </span>
            </div>

            <button
              onClick={stopRecording}
              className="ml-2 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-all shadow-xs active:scale-95 cursor-pointer"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>Stop & Save</span>
            </button>
          </div>
        )}
      </div>

      {/* Video Preview & Sharing Modal */}
      {showPreviewModal && recordedVideoUrl && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full overflow-hidden animate-in fade-in zoom-in-95 space-y-0">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center shadow-xs">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Workflow Video Ready!</h3>
                  <p className="text-xs text-slate-500">
                    Your agent workflow session has been recorded and downloaded to your computer.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowPreviewModal(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Video Player */}
            <div className="p-6 bg-slate-950 flex flex-col items-center justify-center">
              <video
                src={recordedVideoUrl}
                controls
                autoPlay
                className="w-full max-h-[380px] rounded-xl border border-slate-800 shadow-lg object-contain bg-black"
              />
            </div>

            {/* Modal Footer / Actions */}
            <div className="p-5 bg-slate-50 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100">
              <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>Format: WebM / VP9 High-Definition (Universal)</span>
                {recordedBlob && (
                  <span className="font-mono text-slate-400">
                    ({(recordedBlob.size / 1024 / 1024).toFixed(1)} MB)
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  onClick={handleDownloadAgain}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-all shadow-xs cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Download Again</span>
                </button>

                <button
                  onClick={() => setShowPreviewModal(false)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-all shadow-sm shadow-indigo-600/20 active:scale-95 cursor-pointer"
                >
                  <span>Done</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
