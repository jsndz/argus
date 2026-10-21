const { spawn } = require('child_process');
const EventEmitter = require('events');

class MdnsManager extends EventEmitter {
  constructor() {
    super();
    this.hostname = 'argus.local';
    this.ip = null;
    this.status = 'idle'; // 'idle' | 'starting' | 'active' | 'conflict_resolved' | 'error'
    this.provider = null; // 'avahi' | 'multicast-dns'
    this.lastError = null;
    this.conflictCount = 0;

    this.avahiAddrProcess = null;
    this.avahiSvcProcess = null;
    this.mdnsInstance = null;
  }

  async start(ip, baseHostname = 'argus.local') {
    this.ip = ip;
    this.baseHostname = baseHostname.replace(/\.local$/, '');
    this.hostname = `${this.baseHostname}.local`;
    this.status = 'starting';
    this.lastError = null;

    console.log(`[mDNS] Advertising ${this.hostname} -> ${this.ip}`);

    // Attempt native avahi-publish first if available on Linux
    const avahiSuccess = await this._tryStartAvahi();
    if (avahiSuccess) {
      this.provider = 'avahi';
      this.status = this.conflictCount > 0 ? 'conflict_resolved' : 'active';
      return this.getStatus();
    }

    // Fallback to pure-JS multicast-dns
    this._startMulticastDns();
    return this.getStatus();
  }

  async update(newIp) {
    if (this.ip === newIp && this.status === 'active') {
      return this.getStatus();
    }
    console.log(`[mDNS] Updating IP to ${newIp}`);
    await this.stop();
    return this.start(newIp, this.baseHostname || 'argus');
  }

  async stop() {
    this._stopAvahi();
    this._stopMulticastDns();
    this.status = 'idle';
  }

  _stopAvahi() {
    if (this.avahiAddrProcess) {
      try {
        this.avahiAddrProcess.kill('SIGTERM');
      } catch (err) {
        // ignore
      }
      this.avahiAddrProcess = null;
    }
    if (this.avahiSvcProcess) {
      try {
        this.avahiSvcProcess.kill('SIGTERM');
      } catch (err) {
        // ignore
      }
      this.avahiSvcProcess = null;
    }
  }

  _stopMulticastDns() {
    if (this.mdnsInstance) {
      try {
        this.mdnsInstance.destroy();
      } catch (err) {
        // ignore
      }
      this.mdnsInstance = null;
    }
  }

  _tryStartAvahi() {
    return new Promise((resolve) => {
      let resolved = false;
      const targetHost = this.hostname;

      try {
        const addrProc = spawn('avahi-publish-address', ['-R', targetHost, this.ip]);
        this.avahiAddrProcess = addrProc;

        const onOutput = (data) => {
          const str = data.toString();
          if (str.includes('Established under name')) {
            console.log(`[mDNS/Avahi] Address established: ${targetHost} -> ${this.ip}`);
            if (!resolved) {
              resolved = true;
              this._startAvahiService(targetHost);
              resolve(true);
            }
          }
          if (str.toLowerCase().includes('conflict') || str.toLowerCase().includes('collision')) {
            this.conflictCount++;
            console.warn(`[mDNS/Avahi] Hostname collision detected for ${this.hostname}! Resolving...`);
            this.hostname = `${this.baseHostname}-${this.conflictCount + 1}.local`;
            this._stopAvahi();
            this._tryStartAvahi().then(resolve);
          }
        };

        addrProc.stdout.on('data', onOutput);
        addrProc.stderr.on('data', onOutput);

        addrProc.on('error', (err) => {
          if (!resolved) {
            resolved = true;
            this.lastError = err.message;
            resolve(false);
          }
        });

        addrProc.on('exit', (code) => {
          if (!resolved) {
            resolved = true;
            resolve(false);
          } else if (this.status === 'active' || this.status === 'conflict_resolved') {
            console.warn(`[mDNS/Avahi] Process exited with code ${code}. Falling back to multicast-dns.`);
            this._startMulticastDns();
          }
        });

        // Timeout fallback if Avahi doesn't confirm within 1.5s
        setTimeout(() => {
          if (!resolved) {
            if (this.avahiAddrProcess && !this.avahiAddrProcess.killed) {
              // Avahi might be running quietly
              resolved = true;
              this._startAvahiService(targetHost);
              resolve(true);
            } else {
              resolved = true;
              resolve(false);
            }
          }
        }, 1500);
      } catch (err) {
        this.lastError = err.message;
        resolve(false);
      }
    });
  }

  _startAvahiService(targetHost) {
    try {
      this.avahiSvcProcess = spawn('avahi-publish-service', [
        '-H', targetHost,
        'Argus Web UI',
        '_http._tcp',
        '5000',
        'path=/'
      ]);
      this.avahiSvcProcess.stderr.on('data', (d) => {
        // non-critical service logs
      });
    } catch (e) {
      console.warn('[mDNS/Avahi] Service publish error:', e.message);
    }
  }

  _startMulticastDns() {
    try {
      const multicastDns = require('multicast-dns');
      const mdns = multicastDns();
      this.mdnsInstance = mdns;
      this.provider = 'multicast-dns';
      this.status = this.conflictCount > 0 ? 'conflict_resolved' : 'active';

      mdns.on('query', (query) => {
        const questions = query.questions || [];
        const answers = [];

        for (const q of questions) {
          const qName = (q.name || '').toLowerCase();
          const target = this.hostname.toLowerCase();

          if (qName === target && (q.type === 'A' || q.type === 'ANY')) {
            answers.push({
              name: this.hostname,
              type: 'A',
              ttl: 120,
              data: this.ip
            });
          }

          if (
            (qName === '_http._tcp.local' || qName === '_services._dns-sd._udp.local') &&
            (q.type === 'PTR' || q.type === 'ANY')
          ) {
            answers.push({
              name: '_http._tcp.local',
              type: 'PTR',
              ttl: 120,
              data: `Argus Web UI._http._tcp.local`
            });
          }

          if (qName === 'argus web ui._http._tcp.local' && (q.type === 'SRV' || q.type === 'ANY')) {
            answers.push({
              name: 'Argus Web UI._http._tcp.local',
              type: 'SRV',
              ttl: 120,
              data: {
                priority: 0,
                weight: 0,
                port: 5000,
                target: this.hostname
              }
            });
          }
        }

        if (answers.length > 0) {
          mdns.respond({ answers });
        }
      });

      mdns.on('error', (err) => {
        console.error('[mDNS/multicast-dns] Error:', err.message);
        this.status = 'error';
        this.lastError = err.message;
      });

      console.log(`[mDNS/multicast-dns] Listening and advertising ${this.hostname} (${this.ip})`);
    } catch (err) {
      this.status = 'error';
      this.lastError = err.message;
      console.error('[mDNS] Failed to start multicast-dns:', err.message);
    }
  }

  getStatus() {
    return {
      hostname: this.hostname,
      ip: this.ip,
      status: this.status,
      provider: this.provider,
      error: this.lastError
    };
  }
}

const mdnsManager = new MdnsManager();

module.exports = {
  MdnsManager,
  mdnsManager
};
