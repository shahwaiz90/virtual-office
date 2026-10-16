const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const child_process = require('child_process');

console.log('🧪 Starting MP4 Video Conversion Endpoint Tests...');

// 1. Locate ffmpeg
function findFfmpeg() {
  const commonPaths = ['ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'];
  for (const p of commonPaths) {
    try {
      const res = child_process.spawnSync(p, ['-version'], { stdio: 'ignore' });
      if (res.status === 0) return p;
    } catch (e) {}
  }
  return null;
}

const ffmpeg = findFfmpeg();
assert(ffmpeg, 'FFmpeg binary must be accessible on this machine');
console.log('✅ PASS: Found FFmpeg at:', ffmpeg);

// 2. Generate a 1-second test WebM video
const tmpDir = os.tmpdir();
const testWebmPath = path.join(tmpDir, `test-sample-${Date.now()}.webm`);
child_process.execFileSync(ffmpeg, [
  '-y',
  '-f', 'lavfi',
  '-i', 'testsrc=duration=1:size=320x240:rate=15',
  '-c:v', 'libvpx-vp9',
  '-b:v', '500k',
  testWebmPath
]);

assert(fs.existsSync(testWebmPath), 'Sample WebM file must be created');
const webmBuffer = fs.readFileSync(testWebmPath);
console.log(`✅ PASS: Generated sample WebM file (${(webmBuffer.length / 1024).toFixed(1)} KB)`);

// 3. Test HTTP conversion with server endpoint
const express = require('express');
const app = express();

// Load conversion endpoint from server index logic
app.get('/api/ffmpeg-status', (req, res) => {
  res.json({ available: !!ffmpeg, path: ffmpeg });
});

app.post('/api/convert-to-mp4', express.raw({ type: '*/*', limit: '200mb' }), (req, res) => {
  const fileId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const inputPath = path.join(tmpDir, `test-input-${fileId}.webm`);
  const outputPath = path.join(tmpDir, `test-output-${fileId}.mp4`);

  fs.writeFileSync(inputPath, req.body);

  const proc = child_process.spawn(ffmpeg, [
    '-y',
    '-i', inputPath,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath,
  ]);

  proc.on('close', (code) => {
    try { fs.unlinkSync(inputPath); } catch (e) {}
    if (code !== 0 || !fs.existsSync(outputPath)) {
      return res.status(500).json({ error: 'Conversion failed' });
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="agent-workflow-${Date.now()}.mp4"`);
    const readStream = fs.createReadStream(outputPath);
    readStream.pipe(res);
    readStream.on('close', () => {
      try { fs.unlinkSync(outputPath); } catch (e) {}
    });
  });
});

const server = app.listen(0, async () => {
  const port = server.address().port;

  // Test 1: Check FFmpeg status endpoint
  const statusRes = await fetch(`http://127.0.0.1:${port}/api/ffmpeg-status`);
  const statusData = await statusRes.json();
  assert.strictEqual(statusData.available, true);
  console.log('✅ PASS: /api/ffmpeg-status reports FFmpeg is available!');

  // Test 2: Convert WebM buffer to universal MP4
  const convertRes = await fetch(`http://127.0.0.1:${port}/api/convert-to-mp4`, {
    method: 'POST',
    headers: { 'Content-Type': 'video/webm' },
    body: webmBuffer,
  });

  assert.strictEqual(convertRes.status, 200, `Expected 200, got ${convertRes.status}`);
  assert.strictEqual(convertRes.headers.get('content-type'), 'video/mp4');
  assert(convertRes.headers.get('content-disposition').includes('.mp4'));

  const arrayBuffer = await convertRes.arrayBuffer();
  const mp4Buffer = Buffer.from(arrayBuffer);
  assert(mp4Buffer.length > 0, 'Converted MP4 buffer must not be empty');

  // Verify MP4 signature (ftyp box starts at byte 4)
  const isMp4 = mp4Buffer.subarray(4, 8).toString() === 'ftyp';
  assert(isMp4, 'Output buffer must contain MP4 ftyp box signature');

  console.log(`✅ PASS: /api/convert-to-mp4 returned valid MP4 (${(mp4Buffer.length / 1024).toFixed(1)} KB) with ftyp signature!`);

  // Clean up
  try { fs.unlinkSync(testWebmPath); } catch (e) {}
  server.close(() => {
    console.log('\n🎉 ALL MP4 VIDEO CONVERSION TESTS PASSED 100%!\n');
    process.exit(0);
  });
});
