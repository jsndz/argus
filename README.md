# Argus - Zero-Config LAN Video Streaming Platform

Argus is an ultra-low latency, zero-configuration video distribution platform designed for local area networks (LANs). It automatically detects your active network interfaces, advertises a local hostname via mDNS (`argus.local`), and distributes streams using Low-Latency HLS (HTTP Live Streaming) accessible on any mobile device, desktop, or smart display.

---

## Architecture Overview

```
                      +------------------------------------------+
                      |               Host Machine               |
                      |                                          |
                      |  [ FFmpeg ] (Loop Stream)                |
                      |       | (RTSP Ingest :8554)              |
                      |       v                                  |
                      |  [ MediaMTX (Docker) ]                   |
                      |       | (HLS Remux :8888)                |
                      |       v                                  |
                      |  [ Express Server (:5000) ]              |
                      |    - Admin Room (/admin)                 |
                      |    - Dedicated Viewer (/watch)           |
                      |    - HLS Reverse-Proxy (/hls)            |
                      |    - mDNS Advertising (argus.local)      |
                      |    - Automatic NIC Scoring & Binding     |
                      +------------------------------------------+
                                     |           |
               (Direct IP / mDNS)    |           |    (HLS Stream)
                                     v           v
                          [ Other Laptops & Smartphones ]
```

- **Node.js Express Server (`:5000`)**: Manages network discovery, provides the Admin Control Room, generates QR codes, and reverse-proxies the HLS playlist so viewers only ever connect on port `5000` (no firewall issues on secondary ports).
- **MediaMTX (`bluenviron/mediamtx:1`)**: High-performance RTSP media server running in Docker, remuxing RTSP into standard Low-Latency HLS segments.
- **FFmpeg**: Transcodes uploaded video files into an optimized H.264/AAC/Opus loop stream delivered to MediaMTX via RTSP TCP.
- **Avahi / Multicast DNS**: Advertises `argus.local` across the LAN so users don't need to remember raw IP addresses.

---

## Prerequisites

- **Node.js**: v18.0.0 or higher
- **Docker & Docker Compose**: Required for running MediaMTX
- **FFmpeg**: Required on the host machine for stream transcoding (`sudo pacman -S ffmpeg` or `sudo apt install ffmpeg`)
- **Avahi daemon**: Recommended on Linux for native mDNS advertisement (`sudo pacman -S avahi` or `sudo apt install avahi-daemon`)

---

## Quick Start

### 1. Start the MediaMTX Docker Service
```bash
docker compose up -d mediamtx
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Host Firewall (CRITICAL STEP)
If your Linux host runs a firewall such as **UFW** or **firewalld**, incoming connections from other devices on your Wi-Fi will be dropped by default:

```bash
# Allow the Argus web portal and HLS stream (TCP port 5000)
sudo ufw allow 5000/tcp comment "Argus Web UI"

# Allow mDNS discovery for argus.local (UDP port 5353)
sudo ufw allow 5353/udp comment "mDNS ZeroConf"
```

### 4. Start Argus
```bash
node index.js
```

### 5. Access the Interfaces
- **Admin Control Room**: [`http://localhost:5000/admin`](http://localhost:5000/admin)
- **Dedicated Viewer Page**: [`http://localhost:5000/watch`](http://localhost:5000/watch)

---

## Network & Resolution Guide

### Connecting from Another Laptop or Smartphone

Viewers on the same Wi-Fi network can watch the stream using either link:

1. **Direct LAN IP (Recommended for Mobile Hotspots)**:
   ```
   http://<YOUR-LAN-IP>:5000/watch
   ```
   *(e.g., `http://10.99.90.197:5000/watch` — shown in the Admin Control Room and terminal banner)*

2. **mDNS Hostname (Home & Office Wi-Fi Routers)**:
   ```
   http://argus.local:5000/watch
   ```

---

## Troubleshooting Common Network Issues

### 1. Other Laptop Says "Unable to Connect" / Times Out
- **Cause**: The host machine's firewall (such as **UFW**) is active and dropping incoming traffic on port 5000.
- **Fix**: Run `sudo ufw allow 5000/tcp` on the host machine. Argus includes an automatic firewall detector that will highlight this warning in both the terminal and the Admin Control Room.

### 2. `argus.local` Fails on Mobile Hotspots (e.g. Android / iPhone Hotspot)
- **Cause**: Mobile phone hotspots deliberately drop or block client-to-client **Multicast UDP (port 5353)** to save phone battery and reduce Wi-Fi airtime.
- **Fix**: When connected via a mobile hotspot, always use the **Direct LAN IP link** (e.g., `http://10.99.90.197:5000/watch`). Direct IP unicast connections are never blocked by mobile hotspots.

### 3. `argus.local` Fails in the Browser on the Host Linux Laptop ("Server Not Found")
- **Cause**: On Arch Linux and systemd-based distributions, `/etc/nsswitch.conf` often lacks the `mdns_minimal` resolver plugin. As a result, the host's own browser delegates resolution to upstream DNS, which returns `NXDOMAIN` for `.local`.
- **Fix**: Add a static entry to your host's `/etc/hosts` file:
  ```bash
  echo "127.0.0.1 argus.local" | sudo tee -a /etc/hosts
  ```
  *(Or navigate to `http://localhost:5000` on the host machine).*

---

## Web Pages & Endpoints

| Route | Method | Description |
| :--- | :---: | :--- |
| `/admin` | `GET` | Admin Control Room: interface picker, video upload, stream controls, health monitors, and firewall warnings. |
| `/watch` | `GET` | Dedicated viewer page: HLS.js player, tap-to-unmute audio, fullscreen, PiP, and QR code sharing. |
| `/hls/index.m3u8` | `GET` | Reverse-proxied HLS master playlist for external media players (VLC, Safari, QuickTime). |
| `/api/status` | `GET` | Real-time JSON telemetry: active NIC, mDNS status, MediaMTX health, firewall status, and active stream file. |
| `/api/network/interfaces` | `GET` | List all detected IPv4 network interfaces with suitability scores. |
| `/api/network/select` | `POST` | Dynamically rebind Argus, mDNS, and MediaMTX to a different NIC. |
| `/api/mediamtx/restart` | `POST` | Restart and re-probe MediaMTX endpoints. |
| `/api/qr` | `GET` | Returns a Base64 PNG QR code for one-scan viewer onboarding. |
| `/upload` | `POST` | Upload video files (MP4, MKV, MOV, TS). |
| `/start-stream` | `POST` | Launch FFmpeg looped RTSP stream to MediaMTX. |
| `/stop` | `GET` | Stop active FFmpeg stream. |

---

## Testing

Argus includes an automated Node.js test suite verifying network detection, mDNS fallback, MediaMTX configuration, firewall rules, and Express endpoints:

```bash
npm test
```

---

## License

This project is licensed under the MIT License.