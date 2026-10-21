let currentStatus = null;
let networkData = null;

// Toast notification helper
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerText = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Copy to clipboard helper
function copyToClipboard(text, label = 'Link') {
  navigator.clipboard.writeText(text).then(() => {
    showToast(`${label} copied to clipboard!`, 'success');
  }).catch(() => {
    showToast('Failed to copy', 'error');
  });
}

// Format endpoint links
function updateViewerLinks(ip, hostname) {
  const host = hostname || ip || window.location.hostname;
  const webrtcUrl = `http://${host}:8889/live`;
  const rtspUrl = `rtsp://${ip || host}:8554/live`;
  const hlsUrl = `http://${host}:8888/live`;

  const webrtcLinkEl = document.getElementById('webrtc-link');
  const rtspLinkEl = document.getElementById('rtsp-link');
  const hlsLinkEl = document.getElementById('hls-link');

  if (webrtcLinkEl) {
    webrtcLinkEl.href = webrtcUrl;
    webrtcLinkEl.innerText = webrtcUrl;
  }
  if (rtspLinkEl) {
    rtspLinkEl.innerText = rtspUrl;
  }
  if (hlsLinkEl) {
    hlsLinkEl.href = hlsUrl;
    hlsLinkEl.innerText = hlsUrl;
  }

  const lanHeaderLink = document.getElementById('lan-header-link');
  if (lanHeaderLink) {
    lanHeaderLink.href = `http://${host}:5000`;
    lanHeaderLink.innerText = `LAN: http://${host}:5000`;
  }
}

// Populate interface selector dropdown
function renderInterfaceOptions() {
  const select = document.getElementById('interface-select');
  const hideVirtual = document.getElementById('hide-virtual-check').checked;
  if (!select || !networkData) return;

  const currentVal = select.value;
  select.innerHTML = '';

  const interfaces = networkData.interfaces || [];
  const filtered = interfaces.filter(iface => {
    if (hideVirtual && !iface.isSuitable) {
      return false;
    }
    return true;
  });

  filtered.forEach(iface => {
    const opt = document.createElement('option');
    opt.value = iface.address;

    let tags = [];
    if (iface.isRecommended) tags.push('Recommended LAN');
    if (iface.type) tags.push(iface.type.toUpperCase());
    if (!iface.isSuitable) tags.push('Virtual/Bridge');

    const tagStr = tags.length ? ` [${tags.join(' | ')}]` : '';
    opt.innerText = `${iface.name} - ${iface.address}${tagStr}`;

    if (networkData.selected && networkData.selected.address === iface.address) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });

  // If previous value existed and is still present, keep it
  if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
    select.value = currentVal;
  }
}

// Render network info card
function updateNetworkUI(data) {
  networkData = data;
  const activeIpBadge = document.getElementById('active-ip-display');
  const activeHostnameBadge = document.getElementById('active-hostname-display');

  if (data.selected) {
    if (activeIpBadge) activeIpBadge.innerText = `${data.selected.address} (${data.selected.name})`;
    if (activeHostnameBadge) activeHostnameBadge.innerText = data.hostname || 'argus.local';
    updateViewerLinks(data.selected.address, data.hostname);
  }

  renderInterfaceOptions();
}

// Render MediaMTX status card
function updateMediaMtxUI(data) {
  const statusBadge = document.getElementById('mtx-status-indicator');
  const alertBox = document.getElementById('mtx-error-alert');
  const alertMsg = document.getElementById('mtx-error-message');

  const rtspStatus = document.getElementById('mtx-rtsp-status');
  const webrtcStatus = document.getElementById('mtx-webrtc-status');
  const hlsStatus = document.getElementById('mtx-hls-status');
  const apiStatus = document.getElementById('mtx-api-status');

  if (!data) return;

  const endpoints = data.endpoints || {};

  const setEndpointBadge = (el, isOk) => {
    if (!el) return;
    if (isOk) {
      el.className = 'status-indicator status-ok';
      el.innerHTML = '<span class="badge-dot"></span> Online';
    } else {
      el.className = 'status-indicator status-err';
      el.innerHTML = '<span class="badge-dot"></span> Offline';
    }
  };

  setEndpointBadge(rtspStatus, endpoints.rtsp);
  setEndpointBadge(webrtcStatus, endpoints.webrtc);
  setEndpointBadge(hlsStatus, endpoints.hls);
  setEndpointBadge(apiStatus, endpoints.api);

  if (data.status === 'healthy') {
    statusBadge.className = 'badge badge-live';
    statusBadge.innerHTML = '<span class="badge-dot pulse"></span> Healthy';
    if (alertBox) alertBox.style.display = 'none';
  } else if (data.status === 'starting') {
    statusBadge.className = 'badge badge-idle';
    statusBadge.innerHTML = '<span class="badge-dot pulse"></span> Starting...';
    if (alertBox) alertBox.style.display = 'none';
  } else {
    statusBadge.className = 'badge';
    statusBadge.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
    statusBadge.style.color = '#f87171';
    statusBadge.innerHTML = '<span class="badge-dot"></span> Degraded';

    if (alertBox && data.error) {
      alertBox.style.display = 'block';
      alertMsg.innerText = data.error;
    }
  }
}

// Render Stream status badge
function updateStreamUI(streamData) {
  const streamBadge = document.getElementById('stream-status-badge');
  const streamStatusText = document.getElementById('stream-status-text');

  if (streamData && streamData.isStreaming) {
    if (streamBadge) {
      streamBadge.className = 'badge badge-live';
      streamBadge.innerHTML = '<span class="badge-dot pulse"></span> LIVE STREAMING';
    }
    if (streamStatusText) streamStatusText.innerText = `Active file: ${streamData.filePath || 'Streaming'}`;
  } else {
    if (streamBadge) {
      streamBadge.className = 'badge badge-idle';
      streamBadge.innerHTML = '<span class="badge-dot"></span> IDLE';
    }
    if (streamStatusText) streamStatusText.innerText = 'No stream running';
  }
}

// Fetch complete system status
async function refreshStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error('Status endpoint failed');
    currentStatus = await res.json();

    updateNetworkUI(currentStatus.network);
    updateMediaMtxUI(currentStatus.mediamtx);
    updateStreamUI(currentStatus.stream);
  } catch (err) {
    console.error('Failed to refresh status:', err);
  }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  refreshStatus();

  // Polling every 5 seconds for health status
  setInterval(refreshStatus, 5000);

  // Interface selection form
  const applyNicBtn = document.getElementById('apply-nic-btn');
  const nicSelect = document.getElementById('interface-select');
  const hideVirtualCheck = document.getElementById('hide-virtual-check');

  if (hideVirtualCheck) {
    hideVirtualCheck.addEventListener('change', renderInterfaceOptions);
  }

  if (applyNicBtn) {
    applyNicBtn.addEventListener('click', async () => {
      const selectedIp = nicSelect.value;
      if (!selectedIp) return;

      applyNicBtn.disabled = true;
      applyNicBtn.innerText = 'Applying & Reconfiguring...';
      showToast('Configuring network and re-initializing MediaMTX...', 'info');

      try {
        const res = await fetch('/api/network/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: selectedIp })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to update interface');
        }

        showToast(`Successfully bound to ${selectedIp}! MediaMTX updated.`, 'success');
        refreshStatus();
      } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
      } finally {
        applyNicBtn.disabled = false;
        applyNicBtn.innerText = 'Save & Reconfigure';
      }
    });
  }

  // MediaMTX Restart button
  const restartMtxBtn = document.getElementById('restart-mtx-btn');
  if (restartMtxBtn) {
    restartMtxBtn.addEventListener('click', async () => {
      restartMtxBtn.disabled = true;
      restartMtxBtn.innerText = 'Restarting...';
      showToast('Restarting MediaMTX...', 'info');

      try {
        const res = await fetch('/api/mediamtx/restart', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('MediaMTX restarted and verified healthy!', 'success');
        } else {
          showToast(`MediaMTX startup warning: ${data.error}`, 'error');
        }
        refreshStatus();
      } catch (err) {
        showToast(`Restart failed: ${err.message}`, 'error');
      } finally {
        restartMtxBtn.disabled = false;
        restartMtxBtn.innerText = 'Restart MediaMTX';
      }
    });
  }

  // File Upload Form
  const uploadForm = document.getElementById('uploadForm');
  const fileInput = document.getElementById('videoFile');
  const dropzone = document.getElementById('dropzone');
  const uploadBtn = document.getElementById('uploadBtn');
  const fileDetails = document.getElementById('file-details');

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        fileInput.files = e.dataTransfer.files;
        updateFileInfo();
      }
    });

    fileInput.addEventListener('change', updateFileInfo);

    function updateFileInfo() {
      if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
        fileDetails.innerText = `Selected: ${file.name} (${sizeMb} MB)`;
        fileDetails.style.display = 'block';
      }
    }
  }

  if (uploadForm) {
    uploadForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!fileInput.files.length) {
        showToast('Please select a video file first', 'error');
        return;
      }

      const formData = new FormData(uploadForm);
      uploadBtn.disabled = true;
      uploadBtn.innerText = 'Uploading...';
      showToast('Uploading video...', 'info');

      try {
        const res = await fetch('/upload', {
          method: 'POST',
          body: formData
        });

        const text = await res.text();
        if (res.ok) {
          showToast(text, 'success');
          refreshStatus();
        } else {
          showToast(`Upload failed: ${text}`, 'error');
        }
      } catch (err) {
        showToast(`Upload error: ${err.message}`, 'error');
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.innerText = 'Upload Video';
      }
    });
  }

  // Stream Controls
  const startBtn = document.getElementById('startStream');
  const stopBtn = document.getElementById('stopStream');

  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      startBtn.disabled = true;
      showToast('Starting RTSP loop stream...', 'info');

      try {
        const res = await fetch('/start-stream', { method: 'POST' });
        const text = await res.text();
        if (res.ok) {
          showToast('Streaming live!', 'success');
        } else {
          showToast(`Start stream failed: ${text}`, 'error');
        }
        refreshStatus();
      } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
      } finally {
        startBtn.disabled = false;
      }
    });
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', async () => {
      stopBtn.disabled = true;
      showToast('Stopping stream...', 'info');

      try {
        const res = await fetch('/stop');
        const text = await res.text();
        showToast(text, 'info');
        refreshStatus();
      } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
      } finally {
        stopBtn.disabled = false;
      }
    });
  }

  // Copy buttons
  const copyWebrtcBtn = document.getElementById('copy-webrtc-btn');
  const copyRtspBtn = document.getElementById('copy-rtsp-btn');

  if (copyWebrtcBtn) {
    copyWebrtcBtn.addEventListener('click', () => {
      const link = document.getElementById('webrtc-link').innerText;
      copyToClipboard(link, 'WebRTC Player Link');
    });
  }

  if (copyRtspBtn) {
    copyRtspBtn.addEventListener('click', () => {
      const link = document.getElementById('rtsp-link').innerText;
      copyToClipboard(link, 'RTSP Stream URL');
    });
  }
});
