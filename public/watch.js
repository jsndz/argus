let hlsInstance = null;
let isStreamingActive = false;
let pollingTimer = null;
let currentViewerUrl = window.location.href;

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

// Start HLS Playback
function startHlsPlayback() {
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }

  reconnectText.innerText = 'Connecting to HLS live stream...';

  // Primary URL is the proxied /hls/index.m3u8 on port 5000 (single port, no firewall issues)
  const hlsUrl = '/hls/index.m3u8';

  videoEl.muted = true; // Muted autoplay avoids all browser abort exceptions

  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    console.log('[HLS] Initializing HLS.js player for:', hlsUrl);
    hlsInstance = new Hls({
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 5,
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
      statusBadge.innerHTML = '<span class="badge-dot pulse"></span> LIVE';
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
    console.log('[HLS] Using native browser HLS playback');
    videoEl.src = hlsUrl;
    videoEl.addEventListener('loadedmetadata', () => {
      videoEl.play().then(() => {
        unmutePrompt.style.display = 'inline-flex';
      }).catch(() => {
        unmutePrompt.style.display = 'inline-flex';
      });
      offlineOverlay.style.display = 'none';
      statusBadge.className = 'badge badge-live';
      statusBadge.innerHTML = '<span class="badge-dot pulse"></span> LIVE';
    });
    videoEl.addEventListener('error', () => {
      handleStreamDisconnected();
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
  videoEl.src = '';
  unmutePrompt.style.display = 'none';
  offlineOverlay.style.display = 'flex';
  reconnectText.innerText = 'Broadcast offline. Waiting for live stream...';
  statusBadge.className = 'badge badge-idle';
  statusBadge.innerHTML = '<span class="badge-dot"></span> OFFLINE';
}

// Poll server stream status
async function checkStreamStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = await res.json();

    const currentlyLive = data.stream && data.stream.isStreaming;

    if (data.stream && data.stream.filePath) {
      if (streamNameEl) streamNameEl.innerText = `Argus Stream: ${data.stream.filePath}`;
    } else {
      if (streamNameEl) streamNameEl.innerText = 'Argus Live Feed';
    }

    if (currentlyLive) {
      if (!isStreamingActive || !hlsInstance) {
        console.log('[Viewer] Broadcaster is LIVE!');
        isStreamingActive = true;
        startHlsPlayback();
      }
    } else {
      if (isStreamingActive) {
        console.log('[Viewer] Broadcaster stopped stream.');
        isStreamingActive = false;
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
    currentViewerUrl = `http://${host}:5000/watch`;

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
});

window.addEventListener('beforeunload', () => {
  if (hlsInstance) {
    hlsInstance.destroy();
  }
});
