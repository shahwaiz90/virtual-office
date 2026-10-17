// VO-10: shared canvas recording helpers (header recorder + Requirement Replay "Save as video").
// Browser APIs (MediaRecorder, captureStream, fetch, document, URL) are stubbed on globalThis.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recording } from './load_floor_layout.mjs';

const { pickRecorderMime, recordCanvas, canRecordCanvas, saveVideo, replayVideoName } = recording;

class FakeRecorder {
  static supported = new Set();
  static last = null;
  static isTypeSupported(t) {
    return FakeRecorder.supported.has(t);
  }
  constructor(stream, opts) {
    this.stream = stream;
    this.opts = opts;
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onstop = null;
    FakeRecorder.last = this;
  }
  start() {
    this.state = 'recording';
  }
  emit(text) {
    this.ondataavailable?.({ data: new Blob([text]) });
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['tail']) });
    queueMicrotask(() => this.onstop?.());
  }
}

function fakeCanvas() {
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  return { tracks, captureStream: (fps) => ({ fps, getTracks: () => tracks }) };
}

// saveVideo revokes its object URL a minute later; unref that timer so the test run can exit
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => {
  const t = realSetTimeout(fn, ms, ...args);
  if (ms >= 10000) t.unref?.();
  return t;
};

function withDom(fetchImpl) {
  const downloads = [];
  globalThis.document = {
    body: { appendChild() {}, removeChild() {} },
    createElement: () => ({ click() { downloads.push(this.download); } }),
  };
  globalThis.URL.createObjectURL = () => 'blob:x';
  globalThis.URL.revokeObjectURL = () => {};
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return fetchImpl();
  };
  return { downloads, calls };
}

test('pickRecorderMime: native mp4 first, then webm, then plain webm', () => {
  globalThis.MediaRecorder = FakeRecorder;
  FakeRecorder.supported = new Set(['video/mp4', 'video/webm;codecs=vp9']);
  assert.deepEqual(pickRecorderMime(), { mimeType: 'video/mp4', isNativeMp4: true });
  FakeRecorder.supported = new Set(['video/webm;codecs=vp8', 'video/webm']);
  assert.deepEqual(pickRecorderMime(), { mimeType: 'video/webm;codecs=vp8', isNativeMp4: false });
  FakeRecorder.supported = new Set();
  assert.deepEqual(pickRecorderMime(), { mimeType: 'video/webm', isNativeMp4: false });
});

test('recordCanvas: null without captureStream or MediaRecorder', () => {
  globalThis.MediaRecorder = FakeRecorder;
  assert.equal(recordCanvas({}), null);
  assert.equal(canRecordCanvas(null), false);
  delete globalThis.MediaRecorder;
  assert.equal(recordCanvas(fakeCanvas()), null);
});

test('recordCanvas: stop resolves with every chunk and stops the tracks', async () => {
  globalThis.MediaRecorder = FakeRecorder;
  FakeRecorder.supported = new Set(['video/webm']);
  const canvas = fakeCanvas();
  const rec = recordCanvas(canvas);
  assert.ok(rec);
  assert.equal(FakeRecorder.last.stream.fps, 30, 'default 30 fps');
  assert.equal(rec.mimeType, 'video/webm');
  FakeRecorder.last.emit('a');
  const blob = await rec.stop();
  assert.equal(await blob.text(), 'atail');
  assert.equal(blob.type, 'video/webm');
  assert.ok(canvas.tracks[0].stopped);
});

test('recordCanvas: cancel drops the recording', async () => {
  globalThis.MediaRecorder = FakeRecorder;
  const canvas = fakeCanvas();
  const rec = recordCanvas(canvas, 24);
  FakeRecorder.last.emit('a');
  rec.cancel();
  assert.equal(FakeRecorder.last.state, 'inactive');
  assert.ok(canvas.tracks[0].stopped);
  const blob = await rec.stop();
  assert.equal(blob.size, 0, 'nothing recorded survives a cancel');
});

test('saveVideo: native mp4 downloads without converting', async () => {
  const { downloads, calls } = withDom(() => assert.fail('no fetch'));
  assert.equal(await saveVideo(new Blob(['v']), 'video/mp4', 'replay-VO-1-2026-10-17'), 'mp4');
  assert.deepEqual(downloads, ['replay-VO-1-2026-10-17.mp4']);
  assert.equal(calls.length, 0);
});

test('saveVideo: webm is converted to mp4 by the server', async () => {
  const { downloads, calls } = withDom(() => ({ ok: true, status: 200, blob: async () => new Blob(['mp4']) }));
  assert.equal(await saveVideo(new Blob(['v']), 'video/webm;codecs=vp9', 'r'), 'mp4');
  assert.equal(calls[0].url, '/api/convert-to-mp4');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'video/webm;codecs=vp9');
  assert.deepEqual(downloads, ['r.mp4']);
});

test('saveVideo: falls back to webm when conversion fails or the server is unreachable', async () => {
  let dom = withDom(() => ({ ok: false, status: 500 }));
  assert.equal(await saveVideo(new Blob(['v']), 'video/webm', 'r'), 'webm');
  assert.deepEqual(dom.downloads, ['r.webm']);
  dom = withDom(() => {
    throw new Error('offline');
  });
  assert.equal(await saveVideo(new Blob(['v']), 'video/webm', 'r'), 'webm');
  assert.deepEqual(dom.downloads, ['r.webm']);
});

test('replayVideoName: replay-<KEY>-<yyyy-mm-dd> in local time', () => {
  assert.equal(replayVideoName('VO-7', new Date(2026, 0, 5, 23, 59)), 'replay-VO-7-2026-01-05');
});
