const fs = require('fs');

class FirewallDetector {
  checkStatus(port = 5000) {
    const result = {
      detected: false,
      type: null,
      blocked: false,
      portAllowed: false,
      mdnsAllowed: false,
      warning: null,
      remedyCommand: null
    };

    // 1. Check UFW (Uncomplicated Firewall on Ubuntu/Debian/Arch)
    try {
      if (fs.existsSync('/etc/ufw/ufw.conf')) {
        const ufwConf = fs.readFileSync('/etc/ufw/ufw.conf', 'utf-8');
        if (/ENABLED\s*=\s*yes/i.test(ufwConf)) {
          result.detected = true;
          result.type = 'ufw';

          let inputPolicy = 'DROP';
          if (fs.existsSync('/etc/default/ufw')) {
            const defaultUfw = fs.readFileSync('/etc/default/ufw', 'utf-8');
            const match = defaultUfw.match(/DEFAULT_INPUT_POLICY\s*=\s*["']?(\w+)["']?/i);
            if (match) inputPolicy = match[1].toUpperCase();
          }

          let userRules = '';
          if (fs.existsSync('/etc/ufw/user.rules')) {
            userRules = fs.readFileSync('/etc/ufw/user.rules', 'utf-8');
          }

          // Check if port 5000 (or specified port) is explicitly allowed
          const portPattern = new RegExp(`--dport\\s+${port}\\b`, 'i');
          const portAllowed = portPattern.test(userRules);
          result.portAllowed = portAllowed;

          // Check if mDNS 5353 is allowed
          const mdnsPattern = /--dport\s+5353\b/i;
          const mdnsAllowed = mdnsPattern.test(userRules);
          result.mdnsAllowed = mdnsAllowed;

          if (inputPolicy === 'DROP' || inputPolicy === 'REJECT') {
            if (!portAllowed) {
              result.blocked = true;
              result.warning = `UFW firewall is active with DEFAULT_INPUT_POLICY="${inputPolicy}", and port ${port} is NOT allowed. Other devices on your LAN cannot connect until port ${port} is opened.`;
              result.remedyCommand = `sudo ufw allow ${port}/tcp comment "Argus Web UI" && sudo ufw allow 5353/udp comment "mDNS ZeroConf"`;
            } else if (!mdnsAllowed) {
              result.warning = `UFW firewall is active and mDNS (UDP 5353) is NOT allowed. Hostname argus.local will not resolve from other devices on your LAN.`;
              result.remedyCommand = `sudo ufw allow 5353/udp comment "mDNS ZeroConf"`;
            }
          }
          return result;
        }
      }
    } catch (err) {
      // Silently ignore permission/filesystem errors
    }

    return result;
  }
}

const firewallDetector = new FirewallDetector();

module.exports = {
  FirewallDetector,
  firewallDetector
};
