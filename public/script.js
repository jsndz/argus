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
  const lanHost = ip || '127.0.0.1';
  const mdnsHost = hostname || 'argus.local';

  const lanPlayerUrl = `http://${lanHost}:5000/watch`;
  const mdnsPlayerUrl = `http://${mdnsHost}:5000/watch`;
  const hlsStreamUrl = `http://${lanHost}:5000/hls/index.m3u8`;

  const lanPlayerLinkEl = document.getElementById('lan-ip-player-link');
  const playerLinkEl = document.getElementById('hls-player-link');
  const streamLinkEl = document.getElementById('hls-stream-link');

  if (lanPlayerLinkEl) {
    lanPlayerLinkEl.href = lanPlayerUrl;
    lanPlayerLinkEl.innerText = lanPlayerUrl;
  }
  if (playerLinkEl) {
    playerLinkEl.href = mdnsPlayerUrl;
    playerLinkEl.innerText = mdnsPlayerUrl;
  }
  if (streamLinkEl) {
    streamLinkEl.href = hlsStreamUrl;
    streamLinkEl.innerText = hlsStreamUrl;
  }

  const lanHeaderLink = document.getElementById('lan-header-link');
  if (lanHeaderLink) {
    lanHeaderLink.href = `http://${lanHost}:5000`;
    const ipText = document.getElementById('lan-ip-header-text');
    if (ipText) {
      ipText.innerText = `${lanHost}:5000`;
    } else {
      lanHeaderLink.innerHTML = `<span>&#9742;</span> DIRECT: <strong>${lanHost}:5000</strong>`;
    }
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

  setEndpointBadge(hlsStatus, endpoints.hls);
  setEndpointBadge(rtspStatus, endpoints.rtsp);
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

// Render Media Library UI
function updateMediaLibraryUI(mediaList) {
  const countBadge = document.getElementById('upload-count-badge');
  const fileSelect = document.getElementById('stream-file-select');
  const listContainer = document.getElementById('media-library-list');

  const files = mediaList || [];

  if (countBadge) {
    countBadge.innerText = `${files.length} video${files.length !== 1 ? 's' : ''} stored`;
  }

  // Update file select dropdown
  if (fileSelect) {
    const prevVal = fileSelect.value;
    fileSelect.innerHTML = '';

    if (files.length === 0) {
      fileSelect.innerHTML = '<option value="">No videos uploaded yet</option>';
    } else {
      files.forEach((f) => {
        const opt = document.createElement('option');
        opt.value = f.id;
        const sizeMb = (f.size / (1024 * 1024)).toFixed(1);
        opt.innerText = `${f.originalName} (${sizeMb} MB)`;
        fileSelect.appendChild(opt);
      });
      if (prevVal && files.some((f) => f.id === prevVal)) {
        fileSelect.value = prevVal;
      }
    }
  }

  // Update library list
  if (listContainer) {
    if (files.length === 0) {
      listContainer.innerHTML = '<p style="font-size: 13px; color: var(--text-muted);">No videos uploaded yet.</p>';
      return;
    }

    listContainer.innerHTML = '';
    files.forEach((f) => {
      const sizeMb = (f.size / (1024 * 1024)).toFixed(2);
      const timeStr = f.uploadedAt ? new Date(f.uploadedAt).toLocaleTimeString() : '';

      const row = document.createElement('div');
      row.className = 'retro-list-item';

      row.innerHTML = `
        <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">
          <div class="retro-item-title" title="${f.originalName}">${f.originalName}</div>
          <div class="retro-item-sub">${sizeMb} MB &bull; Stored: ${timeStr}</div>
        </div>
        <div style="display: flex; gap: 6px; flex-shrink: 0;">
          <button class="btn btn-success btn-sm quick-stream-btn" data-id="${f.id}" data-name="${encodeURIComponent(f.originalName)}" title="Stream immediately with auto channel ID">&#9658; Stream</button>
          <button class="btn btn-danger btn-sm delete-file-btn" data-id="${f.id}" title="Delete video from vault">&#10005; Delete</button>
        </div>
      `;
      listContainer.appendChild(row);
    });
  }
}

// Render Active Streams UI
function updateActiveStreamsUI(streamsList) {
  const badge = document.getElementById('active-streams-badge');
  const listContainer = document.getElementById('active-streams-list');
  const stopAllBtn = document.getElementById('stop-all-streams-btn');
  const streams = (streamsList || []).filter((s) => s.status === 'active');

  if (badge) {
    if (streams.length > 0) {
      badge.className = 'badge badge-live';
      badge.innerHTML = `<span class="badge-dot pulse"></span> ${streams.length} Active`;
    } else {
      badge.className = 'badge badge-idle';
      badge.innerHTML = '0 Active';
    }
  }

  if (stopAllBtn) {
    stopAllBtn.style.display = streams.length > 0 ? 'inline-block' : 'none';
  }

  if (listContainer) {
    if (streams.length === 0) {
      listContainer.innerHTML = '<p id="no-streams-msg" style="font-size: 13px; color: var(--color-ink-muted); font-style: italic;">No active streams running. Launch a stream below or choose from the Media Vault!</p>';
      return;
    }

    const host = (currentStatus && currentStatus.network && currentStatus.network.selected) ? currentStatus.network.selected.address : window.location.hostname;

    listContainer.innerHTML = '';
    streams.forEach((s) => {
      const hlsFullUrl = `http://${host}:5000/hls/${s.id}/index.m3u8`;
      const item = document.createElement('div');
      item.className = 'retro-stream-item';

      item.innerHTML = `
        <div style="flex: 1; min-width: 180px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="badge badge-live" style="font-size: 11px; padding: 2px 6px;">/${s.id}</span>
            <strong style="font-family: var(--font-heading); color: #ffffff; font-size: 14px;">${s.name}</strong>
          </div>
          <div class="retro-item-sub" style="margin-top: 3px;">
            Source: ${s.fileName || 'Video'} &bull; Transmitting since: ${new Date(s.startedAt).toLocaleTimeString()}
          </div>
        </div>
        <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0;">
          <a href="/watch?stream=${s.id}" target="_blank" class="btn btn-primary btn-sm" style="text-decoration: none;">&#128065; Watch</a>
          <button class="btn btn-secondary btn-sm copy-stream-hls-btn" data-url="${hlsFullUrl}">Copy Link</button>
          <button class="btn btn-danger btn-sm stop-single-stream-btn" data-id="${s.id}">Stop</button>
        </div>
      `;
      listContainer.appendChild(item);
    });
  }
}

// Render Stream status badge in top header
function updateStreamUI(streamData, activeStreams) {
  const streamBadge = document.getElementById('stream-status-badge');
  const count = (activeStreams && activeStreams.length) ? activeStreams.length : (streamData && streamData.isStreaming ? 1 : 0);

  if (count > 0) {
    if (streamBadge) {
      streamBadge.className = 'badge badge-live';
      streamBadge.innerHTML = `<span class="badge-dot pulse"></span> ${count} STREAM${count > 1 ? 'S' : ''} LIVE`;
    }
  } else {
    if (streamBadge) {
      streamBadge.className = 'badge badge-idle';
      streamBadge.innerHTML = '<span class="badge-dot"></span> IDLE';
    }
  }
}

// Render Firewall Alert Banner
function updateFirewallUI(firewall) {
  const alertBox = document.getElementById('firewall-alert-box');
  const alertText = document.getElementById('firewall-alert-text');
  const remedyCode = document.getElementById('firewall-remedy-code');

  if (!alertBox) return;

  if (firewall && (firewall.blocked || firewall.warning)) {
    alertBox.style.display = 'block';
    if (alertText) alertText.innerText = firewall.warning;
    if (remedyCode) remedyCode.innerText = firewall.remedyCommand || '';
  } else {
    alertBox.style.display = 'none';
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
    updateStreamUI(currentStatus.stream, currentStatus.activeStreams);
    updateFirewallUI(currentStatus.firewall);
    updateMediaLibraryUI(currentStatus.media);
    updateActiveStreamsUI(currentStatus.activeStreams);
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

  // Multi-Video Upload Handler (Supports large files up to 100GB with real-time progress)
  const dropzone = document.getElementById('upload-dropzone') || document.getElementById('dropzone') || document.getElementById('upload-form');
  const fileInput = document.getElementById('video-file-input') || document.getElementById('videoFile');
  const browseBtn = document.getElementById('browse-btn');
  const startUploadBtn = document.getElementById('start-upload-btn') || document.getElementById('uploadBtn');
  const summaryText = document.getElementById('selected-files-summary');
  const progressContainer = document.getElementById('upload-progress-container');
  const progressBar = document.getElementById('upload-progress-bar');
  const statusText = document.getElementById('upload-status-text') || document.getElementById('file-details');
  const speedText = document.getElementById('upload-speed-text');

  let pendingFiles = [];

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
  }

  function handleFilesSelected(files) {
    if (!files || files.length === 0) return;
    pendingFiles = Array.from(files);

    const totalBytes = pendingFiles.reduce((sum, f) => sum + f.size, 0);
    const formattedTotal = formatBytes(totalBytes);

    if (summaryText) {
      if (pendingFiles.length === 1) {
        summaryText.innerText = `Selected: ${pendingFiles[0].name} (${formattedTotal})`;
      } else {
        summaryText.innerText = `Selected ${pendingFiles.length} files (${formattedTotal} total)`;
      }
      summaryText.style.display = 'block';
    }

    if (startUploadBtn) {
      startUploadBtn.style.display = 'inline-flex';
      startUploadBtn.innerText = `⬆ Upload ${pendingFiles.length} File${pendingFiles.length > 1 ? 's' : ''} (${formattedTotal})`;
    }

    // Auto-trigger upload immediately for instant responsiveness!
    startUpload();
  }

  function startUpload() {
    if (!pendingFiles || pendingFiles.length === 0) {
      showToast('Please select a video file first', 'error');
      return;
    }

    const formData = new FormData();
    pendingFiles.forEach((file) => {
      formData.append('videos', file);
    });

    if (progressContainer) progressContainer.style.display = 'block';
    if (progressBar) progressBar.style.width = '0%';
    if (statusText) statusText.innerText = 'Starting upload...';
    if (startUploadBtn) startUploadBtn.disabled = true;
    if (browseBtn) browseBtn.disabled = true;

    showToast(`Uploading ${pendingFiles.length} video file(s)...`, 'info');

    const xhr = new XMLHttpRequest();
    const startTime = Date.now();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.min(100, Math.round((e.loaded / e.total) * 100));
        const uploadedStr = formatBytes(e.loaded);
        const totalStr = formatBytes(e.total);
        const elapsedSec = (Date.now() - startTime) / 1000;
        const bytesPerSec = elapsedSec > 0 ? e.loaded / elapsedSec : 0;
        const speedStr = formatBytes(bytesPerSec) + '/s';

        if (progressBar) progressBar.style.width = `${percent}%`;
        if (statusText) statusText.innerText = `Uploading: ${percent}% (${uploadedStr} / ${totalStr})`;
        if (speedText) speedText.innerText = speedStr;
      }
    };

    xhr.onload = () => {
      if (startUploadBtn) {
        startUploadBtn.disabled = false;
        startUploadBtn.style.display = 'none';
      }
      if (browseBtn) browseBtn.disabled = false;

      let resData = {};
      try {
        resData = JSON.parse(xhr.responseText);
      } catch (err) {}

      if (xhr.status >= 200 && xhr.status < 300 && resData.success) {
        showToast(resData.message || 'Video(s) uploaded successfully!', 'success');
        if (progressBar) progressBar.style.width = '100%';
        if (statusText) statusText.innerText = `Upload complete! (${formatBytes(pendingFiles.reduce((s, f) => s + f.size, 0))})`;
        if (speedText) speedText.innerText = 'Done';
        if (summaryText) summaryText.style.display = 'none';
        pendingFiles = [];
        if (fileInput) fileInput.value = '';

        setTimeout(() => {
          if (progressContainer) progressContainer.style.display = 'none';
        }, 3500);

        refreshStatus();
      } else {
        const errorMsg = resData.error || (xhr.status === 413 ? 'File exceeds maximum limit (100 GB)' : `Server responded with HTTP ${xhr.status}`);
        showToast(`Upload failed: ${errorMsg}`, 'error');
        if (statusText) statusText.innerText = `Upload failed: ${errorMsg}`;
      }
    };

    xhr.onerror = () => {
      if (startUploadBtn) startUploadBtn.disabled = false;
      if (browseBtn) browseBtn.disabled = false;
      showToast('Network error during upload. Please check connection.', 'error');
      if (statusText) statusText.innerText = 'Upload failed due to network error.';
    };

    xhr.open('POST', '/upload', true);
    xhr.send(formData);
  }

  if (browseBtn && fileInput) {
    browseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fileInput.click();
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      handleFilesSelected(fileInput.files);
    });
  }

  if (startUploadBtn) {
    startUploadBtn.addEventListener('click', startUpload);
  }

  if (dropzone) {
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
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFilesSelected(e.dataTransfer.files);
      }
    });
  }

  // Launch Stream Channel Form
  const launchForm = document.getElementById('launchStreamForm');
  const launchBtn = document.getElementById('launch-stream-btn');
  if (launchForm) {
    launchForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fileId = document.getElementById('stream-file-select').value;
      const streamId = (document.getElementById('stream-id-input').value || 'live').trim();
      const name = (document.getElementById('stream-name-input').value || '').trim();

      if (!fileId) {
        showToast('Please select a video file first', 'error');
        return;
      }

      if (launchBtn) {
        launchBtn.disabled = true;
        launchBtn.innerText = 'Starting...';
      }
      showToast(`Starting stream on /${streamId}...`, 'info');

      try {
        const res = await fetch('/api/streams/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId, streamId, name })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          showToast(`Channel /${streamId} is LIVE!`, 'success');
          refreshStatus();
        } else {
          showToast(`Start stream failed: ${data.error || 'Unknown error'}`, 'error');
        }
      } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
      } finally {
        if (launchBtn) {
          launchBtn.disabled = false;
          launchBtn.innerText = '► Start Streaming Channel';
        }
      }
    });
  }

  // Stop All Streams Button
  const stopAllBtn = document.getElementById('stop-all-streams-btn');
  if (stopAllBtn) {
    stopAllBtn.addEventListener('click', async () => {
      if (!confirm('Stop all active live streams?')) return;
      try {
        await fetch('/api/streams/stop-all', { method: 'POST' });
        showToast('All streams stopped.', 'info');
        refreshStatus();
      } catch (e) {
        showToast('Error stopping streams', 'error');
      }
    });
  }

  // Refresh Media Library Button
  const refreshMediaBtn = document.getElementById('refresh-media-btn');
  if (refreshMediaBtn) {
    refreshMediaBtn.addEventListener('click', () => {
      refreshStatus();
      showToast('Media library refreshed', 'info');
    });
  }

  // Delegated Actions: Media Library & Active Streams
  document.addEventListener('click', async (e) => {
    // Quick Stream button (Immediate start without form)
    const quickStreamBtn = e.target.closest('.quick-stream-btn');
    if (quickStreamBtn) {
      const fileId = quickStreamBtn.dataset.id;
      const rawName = decodeURIComponent(quickStreamBtn.dataset.name || '');
      quickStreamBtn.disabled = true;
      quickStreamBtn.innerText = 'Starting...';
      showToast(`Starting stream for "${rawName}"...`, 'info');

      try {
        const res = await fetch('/api/streams/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId, name: rawName })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          showToast(`Channel /${data.stream.id} is now LIVE!`, 'success');
          refreshStatus();
        } else {
          showToast(`Stream failed: ${data.error || 'Unknown error'}`, 'error');
        }
      } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
      } finally {
        quickStreamBtn.disabled = false;
        quickStreamBtn.innerText = '▶ Stream Now';
      }
      return;
    }

    // Select/Custom button in Media Library (populates form for customization)
    const streamBtn = e.target.closest('.select-file-btn, .stream-file-btn');
    if (streamBtn) {
      const fileId = streamBtn.dataset.id;
      const rawName = decodeURIComponent(streamBtn.dataset.name || '');
      const select = document.getElementById('stream-file-select');
      const idInput = document.getElementById('stream-id-input');
      const nameInput = document.getElementById('stream-name-input');

      if (select) select.value = fileId;
      if (nameInput) nameInput.value = rawName;
      if (idInput) {
        const slug = rawName.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 16);
        idInput.value = slug || 'stream-1';
      }
      showToast(`Selected "${rawName}". Customize channel below & click Start!`, 'info');
      const launchCard = document.getElementById('launchStreamForm');
      if (launchCard) launchCard.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    // Delete button in Media Library
    const delBtn = e.target.closest('.delete-file-btn');
    if (delBtn) {
      const fileId = delBtn.dataset.id;
      if (!confirm('Are you sure you want to delete this video file?')) return;
      try {
        const res = await fetch(`/api/media/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          showToast('Video deleted from library', 'info');
          refreshStatus();
        } else {
          showToast('Failed to delete file', 'error');
        }
      } catch (err) {
        showToast('Error deleting file', 'error');
      }
      return;
    }

    // Stop single stream button
    const stopSingleBtn = e.target.closest('.stop-single-stream-btn');
    if (stopSingleBtn) {
      const streamId = stopSingleBtn.dataset.id;
      try {
        const res = await fetch(`/api/streams/${encodeURIComponent(streamId)}/stop`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast(`Channel /${streamId} stopped`, 'info');
          refreshStatus();
        }
      } catch (err) {
        showToast('Error stopping stream', 'error');
      }
      return;
    }

    // Copy stream HLS button
    const copyHlsBtn = e.target.closest('.copy-stream-hls-btn');
    if (copyHlsBtn) {
      const url = copyHlsBtn.dataset.url;
      copyToClipboard(url, 'Channel HLS URL');
      return;
    }
  });

  // Copy buttons
  const copyLanIpBtn = document.getElementById('copy-lan-ip-btn');
  const copyPlayerBtn = document.getElementById('copy-hls-player-btn');
  const copyStreamBtn = document.getElementById('copy-hls-stream-btn');
  const copyFirewallBtn = document.getElementById('copy-firewall-btn');

  if (copyLanIpBtn) {
    copyLanIpBtn.addEventListener('click', () => {
      const link = document.getElementById('lan-ip-player-link').innerText;
      copyToClipboard(link, 'Direct LAN IP Link');
    });
  }

  if (copyPlayerBtn) {
    copyPlayerBtn.addEventListener('click', () => {
      const link = document.getElementById('hls-player-link').innerText;
      copyToClipboard(link, 'mDNS Player Link');
    });
  }

  if (copyStreamBtn) {
    copyStreamBtn.addEventListener('click', () => {
      const link = document.getElementById('hls-stream-link').innerText;
      copyToClipboard(link, 'HLS Stream Link');
    });
  }

  if (copyFirewallBtn) {
    copyFirewallBtn.addEventListener('click', () => {
      const cmd = document.getElementById('firewall-remedy-code').innerText;
      copyToClipboard(cmd, 'Firewall Fix Command');
    });
  }
});
