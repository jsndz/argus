let hlsInstance = null;
let isStreamingActive = false;
let currentLoadedUrl = null;
let isConnecting = false;
let pollingTimer = null;
let currentViewerUrl = window.location.href;

const urlParams = new URLSearchParams(window.location.search);
let currentChannel = urlParams.get('stream') || null;

const videoEl = document.getElementById('liveVideo');
const offlineOverlay = document.getElementById('offlineOverlay');
const statusBadge = document.getElementById('viewer-status-badge');
const unmutePrompt = document.getElementById('unmutePrompt');
const streamNameEl = document.getElementById('streamName');
const reconnectText = document.getElementById('reconnect-text');

// Toast helper
function showToast(msg, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerText = msg;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Copy helper
function copyToClipboard(text, label = 'Link') {
  navigator.clipboard.writeText(text).then(() => {
    showToast(`${label} copied to clipboard!`, 'success');
  }).catch(() => {
    showToast('Failed to copy', 'error');
  });
}

// Switch Active Channel
function switchChannel(channelId) {
  if (currentChannel === channelId && isStreamingActive) return;
  currentChannel = channelId;

  // Update browser address bar without reload
  const newUrl = new URL(window.location.href);
  newUrl.searchParams.set('stream', channelId);
  window.history.replaceState({}, '', newUrl.toString());

  currentLoadedUrl = null;
  isStreamingActive = false;
  isConnecting = false;
  startHlsPlayback();
  checkStreamStatus();
}

// Render Gallery / Grid of All Active Streams
function updateStreamsGallery(activeStreams, host) {
  const grid = document.getElementById('activeStreamsGrid');
  const emptyCard = document.getElementById('noStreamsCard');
  const countIndicator = document.getElementById('streams-count-indicator');
  if (!grid) return;

  const streams = (activeStreams || []).filter((s) => s.status === 'active');

  if (countIndicator) {
    if (streams.length > 0) {
      countIndicator.className = 'badge badge-live';
      countIndicator.innerHTML = `<span class="badge-dot pulse"></span> ${streams.length} Stream${streams.length !== 1 ? 's' : ''} Active`;
    } else {
      countIndicator.className = 'badge badge-idle';
      countIndicator.innerHTML = '<span class="badge-dot"></span> 0 Streams Active';
    }
  }

  if (streams.length === 0) {
    grid.innerHTML = '';
    if (emptyCard) emptyCard.style.display = 'block';
    return;
  }

  if (emptyCard) emptyCard.style.display = 'none';
  grid.innerHTML = '';

  const activeChannelId = currentChannel || (streams[0] ? streams[0].id : 'live');

  streams.forEach((s) => {
    const isPlaying = s.id === activeChannelId;
    const card = document.createElement('div');
    card.className = `stream-card-1996 ${isPlaying ? 'active-playing' : ''}`;

    const shareUrl = `http://${host}:5000/watch?stream=${encodeURIComponent(s.id)}`;
    const startTimeStr = s.startedAt ? new Date(s.startedAt).toLocaleTimeString() : 'Live';

    card.innerHTML = `
      <div class="stream-card-header">
        <span style="font-family: var(--font-mono); font-weight: bold; font-size: 11px;">/${s.id}</span>
        <span class="badge ${isPlaying ? 'badge-live' : 'badge-idle'}" style="font-size: 10px; padding: 2px 6px;">
          ${isPlaying ? '<span class="badge-dot pulse"></span> ON AIR (PLAYING)' : 'TRANSMITTING'}
        </span>
      </div>

      <div class="stream-card-body">
        <div class="stream-card-title">${s.name || s.fileName || 'Live Channel Feed'}</div>
        <div style="font-family: var(--font-body); font-size: 13px; color: #444444; margin-top: 4px;">
          Transmitting video: <em>${s.fileName || 'Video File'}</em>
        </div>
        <div style="font-family: var(--font-body); font-size: 12px; color: #666666; margin-top: 4px;">
          Broadcast started at ${startTimeStr} &bull; 1080p HLS
        </div>
      </div>

      <div class="stream-card-actions">
        <button class="btn ${isPlaying ? 'btn-secondary' : 'btn-primary'} btn-sm switch-channel-btn" data-channel="${s.id}" style="flex: 1;">
          ${isPlaying ? '&#10003; Watching Now' : '&#9654; Watch Channel'}
        </button>
        <button class="btn btn-secondary btn-sm copy-stream-link-btn" data-url="${shareUrl}" title="Copy Direct Share Link">
          &#128279; Share
        </button>
      </div>
    `;

    grid.appendChild(card);
  });
}

// Start HLS Playback for currentChannel
function startHlsPlayback() {
  const channelSlug = currentChannel || 'live';
  const hlsUrl = `/hls/${encodeURIComponent(channelSlug)}/index.m3u8`;

  // Guard: If we are already playing or connecting to this exact HLS URL, DO NOT RELOAD!
  if (currentLoadedUrl === hlsUrl && (isStreamingActive || isConnecting)) {
    return;
  }

  currentLoadedUrl = hlsUrl;
  isConnecting = true;
  reconnectText.innerText = `Connecting to channel /${channelSlug}...`;

  // Safety timeout in case load stalls
  clearTimeout(startHlsPlayback._connectTimeout);
  startHlsPlayback._connectTimeout = setTimeout(() => {
    if (isConnecting && !isStreamingActive) {
      console.warn('[HLS] Connection attempt timed out, allowing retry.');
      isConnecting = false;
    }
  }, 8000);

  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }

  videoEl.muted = true; // Muted autoplay avoids browser abort exceptions

  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    console.log('[HLS] Initializing HLS.js player for:', hlsUrl);
    hlsInstance = new Hls({
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 6,
      maxBufferLength: 10,
      enableWorker: true,
      lowLatencyMode: true
    });

    hlsInstance.loadSource(hlsUrl);
    hlsInstance.attachMedia(videoEl);

    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
      console.log('[HLS] Manifest parsed, starting playback...');
      videoEl.play().then(() => {
        unmutePrompt.style.display = 'inline-flex';
      }).catch((err) => {
        console.log('[HLS] Autoplay waiting for click:', err.message);
        unmutePrompt.style.display = 'inline-flex';
      });

      offlineOverlay.style.display = 'none';
      statusBadge.className = 'badge badge-live';
      statusBadge.innerHTML = `<span class="badge-dot pulse"></span> LIVE (/${channelSlug})`;
      isStreamingActive = true;
      isConnecting = false;
    });

    hlsInstance.on(Hls.Events.ERROR, (event, data) => {
      console.warn('[HLS] Error event:', data.type, data.details);
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            console.log('[HLS] Network error, recovering...');
            hlsInstance.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.log('[HLS] Media error, recovering...');
            hlsInstance.recoverMediaError();
            break;
          default:
            handleStreamDisconnected();
            break;
        }
      }
    });
  } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    // Native HLS for Safari / iOS
    console.log('[HLS] Using native browser HLS playback for:', hlsUrl);
    if (!videoEl.src || !videoEl.src.endsWith(hlsUrl)) {
      videoEl.src = hlsUrl;
      videoEl.load();
    }
    videoEl.play().then(() => {
      offlineOverlay.style.display = 'none';
      statusBadge.className = 'badge badge-live';
      statusBadge.innerHTML = `<span class="badge-dot pulse"></span> LIVE (/${channelSlug})`;
      isStreamingActive = true;
      isConnecting = false;
      unmutePrompt.style.display = 'inline-flex';
    }).catch((err) => {
      console.log('[HLS] Autoplay waiting for user gesture:', err.message);
      offlineOverlay.style.display = 'none';
      statusBadge.className = 'badge badge-live';
      statusBadge.innerHTML = `<span class="badge-dot pulse"></span> LIVE (/${channelSlug})`;
      isStreamingActive = true;
      isConnecting = false;
      unmutePrompt.style.display = 'inline-flex';
    });
  } else {
    showToast('Your browser does not support HLS playback', 'error');
  }
}

function handleStreamDisconnected() {
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
  currentLoadedUrl = null;
  videoEl.src = '';
  unmutePrompt.style.display = 'none';
  offlineOverlay.style.display = 'flex';
  const channelSlug = currentChannel || 'live';
  reconnectText.innerText = `Channel /${channelSlug} is offline. Listening for broadcast...`;
  statusBadge.className = 'badge badge-idle';
  statusBadge.innerHTML = '<span class="badge-dot"></span> OFFLINE';
  isStreamingActive = false;
  isConnecting = false;
}

// Render multi-channel selector buttons
function updateChannelBar(activeStreams) {
  const container = document.getElementById('channelBarContainer');
  const btnBox = document.getElementById('channelButtons');
  if (!container || !btnBox) return;

  const streams = activeStreams || [];

  if (streams.length <= 1) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  btnBox.innerHTML = '';

  streams.forEach((s) => {
    const btn = document.createElement('button');
    const isCurrent = s.id === (currentChannel || 'live');
    btn.className = isCurrent ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
    btn.style.fontSize = '12px';
    btn.innerHTML = `<span class="badge-dot ${isCurrent ? 'pulse' : ''}"></span> /${s.id}: ${s.name}`;
    btn.addEventListener('click', () => switchChannel(s.id));
    btnBox.appendChild(btn);
  });
}

// Poll server stream status
async function checkStreamStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = await res.json();

    const activeStreams = data.activeStreams || [];

    // If no channel was chosen yet, pick first active channel or 'live'
    if (!currentChannel) {
      if (activeStreams.length > 0) {
        currentChannel = activeStreams[0].id;
      } else {
        currentChannel = 'live';
      }
    }

    const host = (data.network && data.network.selected) ? data.network.selected.address : window.location.hostname;

    updateChannelBar(activeStreams);
    updateStreamsGallery(activeStreams, host);

    // Find the currently selected stream
    const activeStream = activeStreams.find((s) => s.id === currentChannel);

    if (activeStream) {
      if (streamNameEl) streamNameEl.innerText = `${activeStream.name} (/${activeStream.id})`;
      if (!isStreamingActive && !isConnecting) {
        console.log(`[Viewer] Channel /${currentChannel} is LIVE! Starting playback.`);
        startHlsPlayback();
      }
    } else {
      if (streamNameEl) streamNameEl.innerText = `Channel /${currentChannel}`;
      if (isStreamingActive || currentLoadedUrl) {
        console.log(`[Viewer] Channel /${currentChannel} stopped.`);
        handleStreamDisconnected();
      }
    }
  } catch (err) {
    // Network or server temporarily unavailable
  }
}

// Load QR Code for sharing
async function loadQrCode() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    const host = (data.network && data.network.selected) ? data.network.selected.address : window.location.hostname;
    const channelParam = currentChannel ? `?stream=${encodeURIComponent(currentChannel)}` : '';
    currentViewerUrl = `http://${host}:5000/watch${channelParam}`;

    const qrRes = await fetch(`/api/qr?text=${encodeURIComponent(currentViewerUrl)}`);
    const qrData = await qrRes.json();

    const qrImg = document.getElementById('qrImage');
    const urlDisplay = document.getElementById('shareUrlDisplay');
    if (qrImg && qrData.qr) qrImg.src = qrData.qr;
    if (urlDisplay) urlDisplay.innerText = currentViewerUrl;
  } catch (e) {
    console.warn('Failed to fetch QR code:', e);
  }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  checkStreamStatus();
  pollingTimer = setInterval(checkStreamStatus, 3000);

  // Unmute button
  if (unmutePrompt) {
    unmutePrompt.addEventListener('click', () => {
      videoEl.muted = false;
      unmutePrompt.style.display = 'none';
      showToast('Audio unmuted', 'info');
    });
  }

  // Click video to unmute
  if (videoEl) {
    videoEl.addEventListener('click', () => {
      if (videoEl.muted) {
        videoEl.muted = false;
        if (unmutePrompt) unmutePrompt.style.display = 'none';
        showToast('Audio unmuted', 'info');
      }
    });

    // Handle native playback events (critical for mobile iOS Safari / WebKit)
    videoEl.addEventListener('playing', () => {
      offlineOverlay.style.display = 'none';
      const channelSlug = currentChannel || 'live';
      statusBadge.className = 'badge badge-live';
      statusBadge.innerHTML = `<span class="badge-dot pulse"></span> LIVE (/${channelSlug})`;
      isStreamingActive = true;
      isConnecting = false;
    });

    videoEl.addEventListener('error', () => {
      console.warn('[Video] Native media error:', videoEl.error);
    });
  }

  // Fullscreen button
  const fsBtn = document.getElementById('fullscreenBtn');
  if (fsBtn) {
    fsBtn.addEventListener('click', () => {
      const card = document.querySelector('.player-card');
      if (!document.fullscreenElement) {
        if (card.requestFullscreen) card.requestFullscreen();
      } else {
        if (document.exitFullscreen) document.exitFullscreen();
      }
    });
  }

  // Picture in Picture
  const pipBtn = document.getElementById('pipBtn');
  if (pipBtn) {
    pipBtn.addEventListener('click', async () => {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else if (document.pictureInPictureEnabled) {
          await videoEl.requestPictureInPicture();
        }
      } catch (err) {
        showToast('Picture-in-Picture not available', 'error');
      }
    });
  }

  // Copy link buttons
  const copyBtn = document.getElementById('copyLinkBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      copyToClipboard(currentViewerUrl, 'Viewer Link');
    });
  }

  const copyModalBtn = document.getElementById('copyModalLinkBtn');
  if (copyModalBtn) {
    copyModalBtn.addEventListener('click', () => {
      copyToClipboard(currentViewerUrl, 'Viewer Link');
    });
  }

  // Share / QR Modal
  const shareBtn = document.getElementById('share-modal-btn');
  const modal = document.getElementById('shareModal');
  const closeBtn = document.getElementById('closeModalBtn');

  if (shareBtn && modal) {
    shareBtn.addEventListener('click', () => {
      loadQrCode();
      modal.style.display = 'flex';
    });
  }

  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
  }

  // Delegated click listeners for stream cards in gallery
  document.addEventListener('click', (e) => {
    const switchBtn = e.target.closest('.switch-channel-btn');
    if (switchBtn) {
      const channel = switchBtn.dataset.channel;
      if (channel) {
        switchChannel(channel);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        showToast(`Switched to channel /${channel}`, 'info');
      }
      return;
    }

    const copyStreamBtn = e.target.closest('.copy-stream-link-btn');
    if (copyStreamBtn) {
      const url = copyStreamBtn.dataset.url;
      if (url) copyToClipboard(url, 'Channel Stream Link');
      return;
    }
  });
});

window.addEventListener('beforeunload', () => {
  if (hlsInstance) {
    hlsInstance.destroy();
  }
});
