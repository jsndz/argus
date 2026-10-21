const os = require('os');
const fs = require('fs');
const path = require('path');

const getConfigPath = () => process.env.ARGUS_CONFIG_PATH || path.join(__dirname, '..', 'argus-config.json');

function isLoopback(name, net) {
  return net.internal || name === 'lo' || net.address === '127.0.0.1';
}

function isDockerBridge(name) {
  return /^br-[a-f0-9]+$/i.test(name) || /^docker[0-9]*$/i.test(name);
}

function isVirtual(name) {
  return (
    isDockerBridge(name) ||
    /^(veth|virbr|vboxnet|vmnet|dummy)[a-f0-9]*$/i.test(name)
  );
}

function isLinkLocal(address) {
  return address.startsWith('169.254.');
}

function isVpn(name) {
  return /^(tun|tap|wg|tailscale)[0-9]*$/i.test(name);
}

function isEthernet(name) {
  return /^(eth|en|eno|enp|ens)[0-9a-z]*$/i.test(name);
}

function isWifi(name) {
  return /^(wl|wlan|wlp|wls)[0-9a-z]*$/i.test(name);
}

function isPrivateLanIp(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4) return false;
  // 10.0.0.0/8
  if (parts[0] === 10) return true;
  // 172.16.0.0/12
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

function classifyInterface(name, net) {
  const loopback = isLoopback(name, net);
  const docker = isDockerBridge(name);
  const virtual = isVirtual(name);
  const linkLocal = isLinkLocal(net.address);
  const vpn = isVpn(name);
  const wifi = isWifi(name);
  const ethernet = isEthernet(name);

  let type = 'other';
  if (loopback) type = 'loopback';
  else if (docker) type = 'docker-bridge';
  else if (virtual) type = 'virtual';
  else if (vpn) type = 'vpn';
  else if (wifi) type = 'wifi';
  else if (ethernet) type = 'ethernet';

  const isSuitable = !loopback && !docker && !virtual && !linkLocal;

  let score = 0;
  if (isSuitable) {
    if (ethernet) {
      score = isPrivateLanIp(net.address) ? 100 : 80;
    } else if (wifi) {
      score = isPrivateLanIp(net.address) ? 90 : 75;
    } else if (vpn) {
      score = 40;
    } else {
      score = isPrivateLanIp(net.address) ? 60 : 30;
    }
  } else if (!loopback && !linkLocal) {
    score = 10;
  }

  return {
    type,
    isSuitable,
    score
  };
}

function detectAllInterfaces() {
  const ifaces = os.networkInterfaces();
  const list = [];

  for (const [name, nets] of Object.entries(ifaces)) {
    if (!nets) continue;
    for (const net of nets) {
      // Phase 1 specifies IPv4 network interfaces
      if (net.family !== 'IPv4' && net.family !== 4) {
        continue;
      }

      const classification = classifyInterface(name, net);

      list.push({
        name,
        address: net.address,
        netmask: net.netmask,
        mac: net.mac,
        internal: net.internal,
        cidr: net.cidr,
        type: classification.type,
        isSuitable: classification.isSuitable,
        score: classification.score,
        isRecommended: false
      });
    }
  }

  // Find the highest-scoring interface for recommendation
  let maxScore = -1;
  let bestIdx = -1;
  for (let i = 0; i < list.length; i++) {
    if (list[i].score > maxScore) {
      maxScore = list[i].score;
      bestIdx = i;
    }
  }

  if (bestIdx >= 0 && maxScore > 0) {
    list[bestIdx].isRecommended = true;
  }

  return list;
}

function loadSavedConfig() {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return data || {};
    }
  } catch (err) {
    console.warn('[Network] Failed to parse config file:', err.message);
  }
  return {};
}

function saveConfig(config) {
  try {
    const configPath = getConfigPath();
    const existing = loadSavedConfig();
    const updated = { ...existing, ...config };
    fs.writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Network] Failed to write config file:', err.message);
  }
}

class NetworkManager {
  constructor() {
    this.selectedInterface = null;
    this.refresh();
  }

  refresh() {
    this.interfaces = detectAllInterfaces();
    this.recommended = this.interfaces.find((iface) => iface.isRecommended) || null;

    const saved = loadSavedConfig();
    let chosen = null;

    if (saved.selectedIp) {
      chosen = this.interfaces.find((i) => i.address === saved.selectedIp);
      if (!chosen && saved.selectedInterface) {
        chosen = this.interfaces.find((i) => i.name === saved.selectedInterface);
      }
    }

    if (chosen) {
      this.selectedInterface = chosen;
      this.isManual = true;
    } else {
      this.selectedInterface = this.recommended || this.interfaces[0] || null;
      this.isManual = false;
    }

    return this.getNetworkInfo();
  }

  getNetworkInfo() {
    return {
      interfaces: this.interfaces,
      recommended: this.recommended,
      selected: this.selectedInterface,
      isManual: this.isManual,
      hostname: 'argus.local'
    };
  }

  select(ipOrName) {
    this.interfaces = detectAllInterfaces();
    const target = this.interfaces.find(
      (i) => i.address === ipOrName || i.name === ipOrName
    );

    if (!target) {
      throw new Error(`Interface/IP "${ipOrName}" was not found among available interfaces.`);
    }

    this.selectedInterface = target;
    this.isManual = true;

    saveConfig({
      selectedIp: target.address,
      selectedInterface: target.name
    });

    return this.getNetworkInfo();
  }

  getSelectedIp() {
    return this.selectedInterface ? this.selectedInterface.address : '127.0.0.1';
  }
}

const networkManager = new NetworkManager();

module.exports = {
  NetworkManager,
  networkManager,
  detectAllInterfaces,
  classifyInterface,
  isSuitableInterface: (name, net) => classifyInterface(name, net).isSuitable
};
