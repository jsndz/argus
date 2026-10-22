const { spawn } = require('child_process');
const fs = require('fs');
const EventEmitter = require('events');

class StreamManager extends EventEmitter {
  constructor() {
    super();
    this.streams = new Map(); // streamId -> StreamRecord
  }

  _sanitizeStreamId(id) {
    if (!id || typeof id !== 'string') return 'live';
    const clean = id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '');
    return clean || 'live';
  }

  startStream({ id = 'live', name = null, filePath, fileName = null, fileId = null }) {
    const streamId = this._sanitizeStreamId(id);

    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`Video file does not exist: ${filePath}`);
    }

    // If stream with this ID is already running, stop it first
    if (this.streams.has(streamId)) {
      this.stopStream(streamId);
    }

    const streamTitle = name && name.trim() ? name.trim() : (fileName || `Stream ${streamId}`);
    const rtspUrl = `rtsp://127.0.0.1:8554/${streamId}`;
    const hlsPath = `/hls/${streamId}/index.m3u8`;

    console.log(`[StreamManager] Starting stream "${streamTitle}" [${streamId}] -> ${rtspUrl}`);

    const ffmpegArgs = [
      '-re',
      '-stream_loop', '-1',
      '-i', filePath,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-ar', '44100',
      '-ac', '2',
      '-rtsp_transport', 'tcp',
      '-f', 'rtsp',
      rtspUrl
    ];

    const child = spawn('ffmpeg', ffmpegArgs);

    const record = {
      id: streamId,
      name: streamTitle,
      fileId: fileId || streamId,
      filePath,
      fileName: fileName || filePath,
      process: child,
      status: 'active',
      startedAt: new Date().toISOString(),
      rtspUrl,
      hlsPath,
      error: null
    };

    let lastStderr = '';
    child.stderr.on('data', (d) => {
      lastStderr += d.toString();
      if (lastStderr.length > 2000) {
        lastStderr = lastStderr.slice(-1000);
      }
    });

    child.on('error', (err) => {
      console.error(`[StreamManager] FFmpeg error on [${streamId}]:`, err.message);
      record.status = 'error';
      record.error = err.message;
      this.emit('stream-error', { id: streamId, error: err.message });
    });

    child.on('exit', (code) => {
      console.log(`[StreamManager] FFmpeg [${streamId}] exited with code ${code}`);
      record.status = 'stopped';
      record.process = null;
      if (code !== 0 && code !== null) {
        record.error = lastStderr.trim().slice(-300) || `Process exited with code ${code}`;
      }
      this.emit('stream-exit', { id: streamId, code, error: record.error });
    });

    this.streams.set(streamId, record);
    this.emit('stream-start', this.getStream(streamId));

    return this.getStream(streamId);
  }

  getNextChannelId(base = 'stream') {
    if (!this.streams.has('live')) {
      return 'live';
    }
    let idx = 1;
    while (this.streams.has(`${base}-${idx}`)) {
      idx++;
    }
    return `${base}-${idx}`;
  }

  stopStream(id) {
    const streamId = this._sanitizeStreamId(id);
    const record = this.streams.get(streamId);

    if (!record) return false;

    if (record.process) {
      try {
        record.process.kill('SIGINT');
      } catch (e) {
        try { record.process.kill('SIGKILL'); } catch (err) {}
      }
      record.process = null;
    }

    record.status = 'stopped';
    this.streams.delete(streamId);
    console.log(`[StreamManager] Stopped stream [${streamId}]`);
    this.emit('stream-stop', { id: streamId });
    return true;
  }

  stopAll() {
    console.log(`[StreamManager] Stopping all ${this.streams.size} active stream(s)...`);
    for (const streamId of this.streams.keys()) {
      this.stopStream(streamId);
    }
  }

  getStream(id) {
    const streamId = this._sanitizeStreamId(id);
    const record = this.streams.get(streamId);
    if (!record) return null;

    const { process, ...publicInfo } = record;
    return publicInfo;
  }

  getAllStreams() {
    const list = [];
    for (const record of this.streams.values()) {
      const { process, ...publicInfo } = record;
      list.push(publicInfo);
    }
    return list;
  }

  getActiveStreams() {
    return this.getAllStreams().filter((s) => s.status === 'active');
  }

  isStreaming(id) {
    if (id) {
      const s = this.getStream(id);
      return !!(s && s.status === 'active');
    }
    return this.getActiveStreams().length > 0;
  }
}

const streamManager = new StreamManager();

module.exports = {
  StreamManager,
  streamManager
};
