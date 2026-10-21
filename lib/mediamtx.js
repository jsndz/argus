const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const { exec } = require('child_process');
const YAML = require('yaml');

const MEDIAMTX_CONFIG_PATH = path.join(__dirname, '..', 'mediamtx.yml');
const DOCKER_COMPOSE_PATH = path.join(__dirname, '..', 'docker-compose.yml');

class MediaMtxManager {
  constructor() {
    this.status = 'unknown'; // 'healthy' | 'starting' | 'error' | 'unknown'
    this.endpoints = {
      rtsp: false,
      hls: false,
      api: false
    };
    this.lastChecked = null;
    this.lastError = null;
  }

  generateConfig(selectedIp, hostname = 'argus.local') {
    const config = {
      logLevel: 'info',
      api: true,
      apiAddress: ':9997',
      authInternalUsers: [
        {
          user: 'any',
          permissions: [
            { action: 'api' },
            { action: 'read' },
            { action: 'publish' }
          ]
        }
      ],
      rtsp: true,
      rtspAddress: ':8554',
      rtspTransports: ['tcp'],
      rtmp: false,
      hls: true,
      hlsAddress: ':8888',
      hlsAlwaysRemux: true,
      webrtc: false,
      paths: {
        live: {},
        all_others: {}
      }
    };

    const yamlStr = YAML.stringify(config);
    fs.writeFileSync(MEDIAMTX_CONFIG_PATH, yamlStr, 'utf-8');
    console.log('[MediaMTX] Generated mediamtx.yml with HLS streaming enabled (WebRTC disabled)');
    return config;
  }

  async startOrRestart() {
    this.status = 'starting';
    this.lastError = null;

    return new Promise((resolve) => {
      console.log('[MediaMTX] Starting / restarting MediaMTX via docker compose...');
      exec('docker compose up -d mediamtx', { cwd: path.join(__dirname, '..') }, async (err, stdout, stderr) => {
        if (err) {
          const errMsg = `Failed to start MediaMTX container: ${err.message}. Output: ${stderr || stdout}`;
          console.error(`[MediaMTX] ${errMsg}`);
          this.status = 'error';
          this.lastError = errMsg;
          resolve({ success: false, error: errMsg });
          return;
        }

        console.log('[MediaMTX] Docker compose command finished. Verifying endpoints...');
        const health = await this.verifyHealth(15000);
        resolve({ success: health.healthy, error: health.error, endpoints: health.endpoints });
      });
    });
  }

  checkTcpPort(port, host = '127.0.0.1', timeoutMs = 1500) {
    return new Promise((resolve) => {
      const socket = net.createConnection({ port, host, timeout: timeoutMs });
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('error', () => {
        resolve(false);
      });
    });
  }

  checkHttpEndpoint(port, endpointPath = '/', timeoutMs = 1500) {
    return new Promise((resolve) => {
      const req = http.get(
        { port, host: '127.0.0.1', path: endpointPath, timeout: timeoutMs },
        (res) => {
          resolve(true);
        }
      );
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.on('error', () => {
        resolve(false);
      });
    });
  }

  async probeEndpoints() {
    const [rtsp, hls, api] = await Promise.all([
      this.checkTcpPort(8554),
      this.checkHttpEndpoint(8888, '/live/'),
      this.checkHttpEndpoint(9997, '/v3/paths/list')
    ]);

    this.endpoints = { rtsp, hls, api };
    this.lastChecked = new Date().toISOString();

    const isHealthy = rtsp && hls && api;
    return {
      healthy: isHealthy,
      endpoints: this.endpoints
    };
  }

  async verifyHealth(timeoutMs = 15000) {
    const startTime = Date.now();
    let lastProbe = null;

    while (Date.now() - startTime < timeoutMs) {
      lastProbe = await this.probeEndpoints();
      if (lastProbe.healthy) {
        this.status = 'healthy';
        this.lastError = null;
        console.log('[MediaMTX] All endpoints verified healthy: RTSP(:8554), HLS(:8888), API(:9997)');
        return {
          healthy: true,
          endpoints: this.endpoints,
          error: null
        };
      }
      await new Promise((r) => setTimeout(r, 600));
    }

    const failed = Object.entries(this.endpoints)
      .filter(([_, ok]) => !ok)
      .map(([name]) => name.toUpperCase());

    const errMsg = `MediaMTX endpoints failed to respond within ${timeoutMs}ms: ${failed.join(', ')}`;
    this.status = 'error';
    this.lastError = errMsg;
    console.error(`[MediaMTX] ${errMsg}`);

    return {
      healthy: false,
      endpoints: this.endpoints,
      error: errMsg
    };
  }

  getStatus() {
    return {
      status: this.status,
      endpoints: this.endpoints,
      lastChecked: this.lastChecked,
      error: this.lastError
    };
  }
}

const mediaMtxManager = new MediaMtxManager();

module.exports = {
  MediaMtxManager,
  mediaMtxManager
};
