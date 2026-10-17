// Shared canvas recording helpers: the header Workflow Recorder and the Requirement Replay "Save as video"
// both pick a recorder format here; the replay also records the floor canvas and saves the file with them.
// Webm recordings are converted to mp4 by the server (POST /api/convert-to-mp4); when that fails the webm
// itself is downloaded. No runtime imports, so tests can load this file in plain Node.

export interface RecorderMime {
  mimeType: string;
  isNativeMp4: boolean;
}

const MP4_TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1',
  'video/mp4;codecs=h264',
  'video/mp4',
];
const WEBM_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

/** Native mp4 when the browser records it, otherwise the best webm (converted to mp4 by the server later) */
export function pickRecorderMime(): RecorderMime {
  const supported = (t: string) =>
    typeof MediaRecorder !== 'undefined' &&
    typeof MediaRecorder.isTypeSupported === 'function' &&
    MediaRecorder.isTypeSupported(t);
  const mp4 = MP4_TYPES.find(supported);
  if (mp4) return { mimeType: mp4, isNativeMp4: true };
  const webm = WEBM_TYPES.find(supported);
  return { mimeType: webm || 'video/webm', isNativeMp4: false };
}

/** Clicks a temporary link that downloads url as filename */
export function downloadUrl(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export interface CanvasRecording {
  mimeType: string;
  isNativeMp4: boolean;
  /** Ends the recording and resolves with everything recorded */
  stop(): Promise<Blob>;
  /** Ends the recording and drops it; nothing is returned or saved */
  cancel(): void;
}

/** True when this browser can record a canvas (captureStream and MediaRecorder); Safari may lack them */
export function canRecordCanvas(canvas: HTMLCanvasElement | null | undefined): canvas is HTMLCanvasElement {
  return (
    !!canvas &&
    typeof (canvas as Partial<HTMLCanvasElement>).captureStream === 'function' &&
    typeof MediaRecorder !== 'undefined'
  );
}

/** Starts recording the canvas at fps (video only); null when the browser cannot record it */
export function recordCanvas(canvas: HTMLCanvasElement, fps = 30): CanvasRecording | null {
  if (!canRecordCanvas(canvas)) return null;
  const { mimeType, isNativeMp4 } = pickRecorderMime();
  let stream: MediaStream;
  let recorder: MediaRecorder;
  try {
    stream = canvas.captureStream(fps);
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8000000 });
  } catch (err) {
    console.warn('Canvas recording could not start:', err);
    return null;
  }

  let chunks: Blob[] = [];
  let finished = false;
  const stopTracks = () => stream.getTracks().forEach((t) => t.stop());
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.start(500);

  return {
    mimeType,
    isNativeMp4,
    stop() {
      return new Promise<Blob>((resolve) => {
        if (finished || recorder.state === 'inactive') {
          finished = true;
          stopTracks();
          resolve(new Blob(chunks, { type: mimeType }));
          return;
        }
        finished = true;
        recorder.onstop = () => {
          stopTracks();
          resolve(new Blob(chunks, { type: mimeType }));
        };
        recorder.stop();
      });
    },
    cancel() {
      if (finished) return;
      finished = true;
      recorder.ondataavailable = null;
      recorder.onstop = null;
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          /* already stopped */
        }
      }
      stopTracks();
      chunks = [];
    },
  };
}

/** "<prefix>-<KEY>-<yyyy-mm-dd>" in local time, the base name of a saved replay video */
export function replayVideoName(key: string, date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `replay-${key}-${day}`;
}

/**
 * Downloads a recording as <baseName>.mp4: native mp4 as is, webm converted by the server. When the
 * conversion fails the webm itself is downloaded. Resolves with the extension that was saved.
 */
export async function saveVideo(blob: Blob, mimeType: string, baseName: string): Promise<'mp4' | 'webm'> {
  const save = (file: Blob, ext: 'mp4' | 'webm') => {
    const url = URL.createObjectURL(file);
    downloadUrl(url, `${baseName}.${ext}`);
    // Give the browser time to start the download before the URL goes away
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return ext;
  };
  if (mimeType.startsWith('video/mp4')) return save(blob, 'mp4');
  try {
    const res = await fetch('/api/convert-to-mp4', {
      method: 'POST',
      headers: { 'Content-Type': mimeType },
      body: blob,
    });
    if (res.ok) return save(await res.blob(), 'mp4');
    console.warn(`MP4 conversion returned HTTP ${res.status}; saving the WebM instead.`);
  } catch (err) {
    console.warn('MP4 conversion failed; saving the WebM instead:', err);
  }
  return save(blob, 'webm');
}
