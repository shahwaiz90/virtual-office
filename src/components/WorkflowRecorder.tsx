import React, { useState, useEffect, useRef } from 'react';
import { Video, Square, Download, X, Sparkles, Loader2 } from 'lucide-react';
import { voiceService } from '../services/voiceService';

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
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedMp4Url, setRecordedMp4Url] = useState<string | null>(null);
  const [recordedMp4Blob, setRecordedMp4Blob] = useState<Blob | null>(null);
  const [isConvertingMp4, setIsConvertingMp4] = useState<boolean>(false);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

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

  const startCanvasRecording = () => {
    if (!canvasElement) {
      alert('Virtual Office canvas is initializing. Please try in a moment.');
      return;
    }

    try {
      // 60 FPS smooth capture directly from Virtual Office canvas
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

      // 2. Add real-time agent voice audio track from VoiceService
      const audioTrack = voiceService.getAudioStreamTrack();
      if (audioTrack) {
        combinedStream.addTrack(audioTrack);
      }

      streamRef.current = combinedStream;
      initRecorderWithStream(combinedStream);
    } catch (e: any) {
      console.error('Failed to capture canvas stream:', e);
      alert(`Could not start canvas recording: ${e.message}`);
    }
  };

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

      // Clean up stream tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

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
            onClick={startCanvasRecording}
            title="Start recording Virtual Office canvas (60 FPS MP4)"
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200/90 transition-all shadow-xs hover:border-slate-300 active:scale-95 cursor-pointer"
          >
            <Video className="w-3.5 h-3.5 text-rose-600" />
            <span className="hidden sm:inline">Record Workflow</span>
            <span className="sm:hidden text-xs">Record</span>
          </button>
        ) : (
          /* Active Recording State Button with Live Timer */
          <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-xl px-3 py-1.5 shadow-sm">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-pulse shrink-0" />
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-black text-rose-700 font-mono">
                REC {formatTime(recordingSeconds)}
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
            <div className="p-6 bg-slate-950 flex flex-col items-center justify-center relative">
              <video
                src={recordedMp4Url || recordedVideoUrl || undefined}
                controls
                autoPlay
                className="w-full max-h-[380px] rounded-xl border border-slate-800 shadow-lg object-contain bg-black"
              />

              {/* MP4 Conversion Overlay Banner */}
              {isConvertingMp4 && (
                <div className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-slate-900/95 border border-indigo-500/50 text-white px-4 py-2 rounded-2xl shadow-2xl flex items-center gap-3 backdrop-blur-md">
                  <Loader2 className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />
                  <div className="text-xs">
                    <span className="font-bold text-indigo-200">Processing MP4...</span>
                    <span className="text-slate-400 ml-1.5 hidden sm:inline">Optimizing for QuickTime, Mac & mobile</span>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer / Actions */}
            <div className="p-5 bg-slate-50 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100">
              <div className="flex items-center gap-2 text-xs font-medium">
                {isConvertingMp4 ? (
                  <div className="flex items-center gap-2 text-indigo-600">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Converting to universal MP4 format...</span>
                  </div>
                ) : recordedMp4Url ? (
                  <div className="flex items-center gap-2 text-emerald-700">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
                    <span className="font-bold">Format: MP4 (H.264 / QuickTime & Universal)</span>
                    {recordedMp4Blob && (
                      <span className="font-mono text-slate-400">
                        ({(recordedMp4Blob.size / 1024 / 1024).toFixed(1)} MB)
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-slate-500">
                    <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0"></span>
                    <span>Format: WebM High-Definition</span>
                    {recordedBlob && (
                      <span className="font-mono text-slate-400">
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
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-all shadow-xs cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-500" />
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
                      ? 'bg-indigo-300 text-white cursor-wait'
                      : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/20 active:scale-95'
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
                  className="px-3.5 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold transition-all cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
