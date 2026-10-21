### Phase 1: Network Discovery and MediaMTX Initialization

1. **Auto IP / NIC Detection**
   - Detect available IPv4 network interfaces on startup.
   - Filter out loopback, Docker bridges, and other unsuitable interfaces by default.
   - Recommend the most suitable LAN IP.
   - Allow the admin to select a preferred IP/interface from the available options.

2. **mDNS Configuration**
   - Advertise `argus.local` using the selected IP.
   - Handle IP changes and hostname conflicts gracefully.
   - Display the selected IP and hostname in the admin interface.

3. **MediaMTX Initialization**
   - Generate the MediaMTX configuration using the selected IP for WebRTC ICE candidates.
   - Configure RTSP ingest and WebRTC playback.
   - Ensure required ports and Docker networking are configured correctly.

4. **Start MediaMTX**
   - Start MediaMTX only after network discovery and configuration are complete.
   - Verify that MediaMTX starts successfully and its endpoints are reachable.
   - Report startup errors clearly in the admin interface.

**Acceptance criteria:** Argus starts with a recommended IP, allows manual selection, advertises `argus.local`, configures MediaMTX with the selected address, and confirms that MediaMTX is healthy before proceeding to Phase 2.