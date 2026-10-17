// ─── TeleDrive Mobile Background Upload & Notification Engine ───
// Keeps uploads active on Android and iOS when screen is locked or app is in background.
// Connects to Media Session API & Web Notifications for live lock-screen & notification bar progress.

(function (window) {
  'use strict';

  // 1-second clean PCM silent WAV data URI
  const SILENT_WAV_URI = 'data:audio/wav;base64,UklGRjIAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YRAAAAAAAAAAAAAAAAAAAAAA';

  let _bgAudioEl = null;
  let _isKeepAliveActive = false;
  let _lastNotifTime = 0;
  let _currentUploadData = null;

  function safeFmtSpeed(bps) {
    if (typeof fmtSpeed === 'function') return fmtSpeed(bps);
    if (!bps || bps <= 0) return '0 B/s';
    if (bps < 1048576) return (bps / 1024).toFixed(1) + ' KB/s';
    return (bps / 1048576).toFixed(1) + ' MB/s';
  }
  function safeFmtEta(sec) {
    if (typeof fmtEtaSec === 'function') return fmtEtaSec(sec);
    if (!sec || sec <= 0) return '';
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m > 0 ? (m + 'm ' + s + 's') : (s + 's');
  }
  function safeFmtBytes(bytes) {
    if (typeof fmt === 'function') return fmt(bytes);
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  // ─── 1. Silent Audio Keep-Alive ───
  function initKeepAliveAudio() {
    if (_bgAudioEl) return _bgAudioEl;
    try {
      _bgAudioEl = document.createElement('audio');
      _bgAudioEl.setAttribute('id', 'tdBgAudioKeepAlive');
      _bgAudioEl.setAttribute('preload', 'auto');
      _bgAudioEl.setAttribute('playsinline', 'true');
      _bgAudioEl.setAttribute('webkit-playsinline', 'true');
      _bgAudioEl.src = SILENT_WAV_URI;
      _bgAudioEl.loop = true;
      _bgAudioEl.volume = 0.001; // virtually inaudible, but keeps audio session active
      document.body.appendChild(_bgAudioEl);

      // Handle pause/ended events from OS
      _bgAudioEl.addEventListener('ended', function () {
        if (_isKeepAliveActive) _bgAudioEl.play().catch(function(){});
      });
      _bgAudioEl.addEventListener('pause', function () {
        if (_isKeepAliveActive && window._isUploading) {
          setTimeout(function() {
            if (_isKeepAliveActive && window._isUploading) _bgAudioEl.play().catch(function(){});
          }, 500);
        }
      });
    } catch (e) {
      console.warn('Audio keep-alive init notice:', e);
    }
    return _bgAudioEl;
  }

  function startMobileKeepAlive() {
    if (_isKeepAliveActive) return;
    _isKeepAliveActive = true;
    const audio = initKeepAliveAudio();
    if (audio) {
      audio.play().then(function() {
        setupMediaSession();
      }).catch(function (err) {
        console.log('Keep-alive auto-play prompt needed:', err);
      });
    }
    // Update mobile status badge if on mobile
    updateBgBadgeUI(true);
  }

  function stopMobileKeepAlive() {
    _isKeepAliveActive = false;
    if (_bgAudioEl) {
      try { _bgAudioEl.pause(); } catch(e){}
    }
    clearMediaSession();
    clearSystemNotification();
    updateBgBadgeUI(false);
  }

  // ─── 2. Media Session API (Android Notification Shade + iOS Lock Screen Widget) ───
  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    try {
      navigator.mediaSession.playbackState = 'playing';

      navigator.mediaSession.setActionHandler('pause', function () {
        if (typeof toggleUploadPause === 'function') toggleUploadPause();
      });

      navigator.mediaSession.setActionHandler('play', function () {
        if (typeof toggleUploadPause === 'function') toggleUploadPause();
      });

      navigator.mediaSession.setActionHandler('stop', function () {
        if (typeof cancelAllUploads === 'function') cancelAllUploads();
        stopMobileKeepAlive();
      });
    } catch (e) {
      console.warn('MediaSession handler setup notice:', e);
    }
  }

  function updateMediaSessionProgress(info) {
    if (!('mediaSession' in navigator)) return;

    const pct = Math.max(0, Math.min(100, Math.round(info.percent || 0)));
    const fileNum = info.fileIndex ? `${info.fileIndex}/${info.totalFiles}` : '';
    const speedStr = info.speed > 0 ? safeFmtSpeed(info.speed) : 'Calculating…';
    const etaStr = info.etaSec ? `~${safeFmtEta(info.etaSec)} left` : '';

    let title = `Uploading ${pct}%`;
    if (fileNum) title += ` (${fileNum})`;

    let artist = `TeleDrive · ${speedStr}`;
    if (etaStr) artist += ` · ${etaStr}`;

    let album = info.fileName || 'Cloud Transfer';
    if (info.batchLoaded && info.batchTotal) {
      album += ` · ${safeFmtBytes(info.batchLoaded)} / ${safeFmtBytes(info.batchTotal)}`;
    }

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title,
        artist: artist,
        album: album,
        artwork: [
          { src: '/favicon.svg', sizes: '96x96', type: 'image/svg+xml' },
          { src: '/favicon.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: '/favicon.svg', sizes: '512x512', type: 'image/svg+xml' }
        ]
      });

      if ('setPositionState' in navigator.mediaSession) {
        navigator.mediaSession.setPositionState({
          duration: 100,
          playbackRate: 1,
          position: pct
        });
      }
    } catch (e) {}
  }

  function clearMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.metadata = null;
    } catch (e) {}
  }

  // ─── 3. Web Notifications API ───
  async function requestNotificationPermission() {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission !== 'denied') {
      try {
        const res = await Notification.requestPermission();
        if (res === 'granted' && typeof toast === 'function') {
          toast('✅ Notifications enabled! Live upload progress will appear in your notification tab.', 'success');
        }
        return res;
      } catch (e) {
        return 'default';
      }
    }
    return Notification.permission;
  }

  function updateSystemNotification(info) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const now = Date.now();
    // Throttle notification updates to once every 3.5 seconds
    if (now - _lastNotifTime < 3500 && info.percent < 100) return;
    _lastNotifTime = now;

    const pct = Math.max(0, Math.min(100, Math.round(info.percent || 0)));
    const fileNum = info.fileIndex ? `(${info.fileIndex}/${info.totalFiles}) ` : '';
    const speedStr = info.speed > 0 ? safeFmtSpeed(info.speed) : '';
    const etaStr = info.etaSec ? `~${safeFmtEta(info.etaSec)} left` : '';

    const title = `TeleDrive: ${pct}% Uploaded ${fileNum}`;
    let body = info.fileName || 'Files uploading to Google Drive…';
    if (speedStr || etaStr) {
      body += `\n${[speedStr, etaStr].filter(Boolean).join(' · ')}`;
    }

    // Try service worker notification first (native background support)
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SHOW_UPLOAD_NOTIFICATION',
        title: title,
        options: {
          body: body,
          tag: 'teledrive-upload-progress',
          renotify: false,
          silent: true
        }
      });
      return;
    }

    // Fallback to standard window Notification
    try {
      new Notification(title, {
        body: body,
        icon: '/favicon.svg',
        tag: 'teledrive-upload-progress',
        renotify: false,
        silent: true
      });
    } catch (e) {}
  }

  function notifyUploadCompleted(summary) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const title = 'TeleDrive: Upload Complete! 🎉';
    const body = summary || 'All files have been safely uploaded to Google Drive.';

    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'UPLOAD_FINISHED_NOTIFICATION',
        title: title,
        body: body
      });
      return;
    }

    try {
      new Notification(title, {
        body: body,
        icon: '/favicon.svg',
        tag: 'teledrive-upload-finished',
        renotify: true,
        vibrate: [200, 100, 200]
      });
    } catch (e) {}
  }

  function clearSystemNotification() {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_UPLOAD_NOTIFICATION' });
    }
  }

  // ─── 4. Public API for upload progress feeds ───
  function onUploadProgressTick(data) {
    _currentUploadData = data;
    if (!_isKeepAliveActive && window._isUploading) {
      startMobileKeepAlive();
    }
    updateMediaSessionProgress(data);
    updateSystemNotification(data);
  }

  function onUploadFinished(summary) {
    notifyUploadCompleted(summary);
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'Upload Complete! 🎉',
          artist: 'TeleDrive Cloud Storage',
          album: summary || 'All files saved to Google Drive',
          artwork: [{ src: '/favicon.svg', sizes: '192x192', type: 'image/svg+xml' }]
        });
        if ('setPositionState' in navigator.mediaSession) {
          navigator.mediaSession.setPositionState({ duration: 100, position: 100, playbackRate: 0 });
        }
      } catch (e) {}
    }
    setTimeout(function () {
      stopMobileKeepAlive();
    }, 15000);
  }

  // ─── 5. UI Badge & Dialogs ───
  function updateBgBadgeUI(active) {
    let badge = document.getElementById('mobileBgUploadBadge');
    if (active) {
      if (!badge) {
        badge = document.createElement('div');
        badge.id = 'mobileBgUploadBadge';
        badge.className = 'mobile-bg-badge';
        badge.innerHTML = '<span class="pulse-dot"></span><span>Background Upload: ON</span>';
        badge.onclick = showMobileBackgroundUploadDialog;
        document.body.appendChild(badge);
      }
      badge.classList.add('visible');
    } else if (badge) {
      badge.classList.remove('visible');
    }
  }

  function showMobileBackgroundUploadDialog() {
    const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
    const isGranted = (perm === 'granted');
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(8px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
    overlay.innerHTML =
      '<div style="background:var(--surface,#13152a);border:1px solid rgba(0,229,255,.3);border-radius:20px;padding:1.5rem;max-width:440px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,.85);">' +
        '<div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1.1rem;">' +
          '<div style="width:44px;height:44px;border-radius:12px;background:rgba(0,229,255,.15);color:#00e5ff;display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0;">' +
            '<i class="fas fa-mobile-screen"></i>' +
          '</div>' +
          '<div>' +
            '<div style="font-size:1.05rem;font-weight:700;color:var(--text1,#e8eaf6);">Mobile Background Upload</div>' +
            '<div style="font-size:.78rem;color:var(--text2,#8c90b0);margin-top:2px;">Lock screen & notification bar progress</div>' +
          '</div>' +
        '</div>' +

        '<div style="display:flex;flex-direction:column;gap:.75rem;margin-bottom:1.2rem;font-size:.82rem;color:var(--text2,#8c90b0);line-height:1.45;">' +
          '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:10px 12px;display:flex;align-items:flex-start;gap:10px;">' +
            '<i class="fas fa-shield-halved" style="color:#30d158;font-size:1.1rem;margin-top:2px;"></i>' +
            '<div>' +
              '<strong style="color:var(--text1,#fff);display:block;margin-bottom:2px;">Works With Black Screen & Minimizing</strong>' +
              'TeleDrive runs a background audio session so iOS and Android keep uploading even when your screen turns black or you switch to WhatsApp or other apps.' +
            '</div>' +
          '</div>' +

          '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:10px 12px;display:flex;align-items:flex-start;gap:10px;">' +
            '<i class="fas fa-sliders" style="color:#0a84ff;font-size:1.1rem;margin-top:2px;"></i>' +
            '<div>' +
              '<strong style="color:var(--text1,#fff);display:block;margin-bottom:2px;">Lock Screen Player Bar</strong>' +
              'Your phone’s Lock Screen media widget shows the live % progress bar, speed, and time left without unlocking!' +
            '</div>' +
          '</div>' +

          '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;">' +
            '<div style="display:flex;align-items:center;gap:10px;">' +
              '<i class="fas fa-bell" style="color:#ffd60a;font-size:1.1rem;"></i>' +
              '<div>' +
                '<strong style="color:var(--text1,#fff);display:block;">Notification Bar Updates</strong>' +
                '<span style="font-size:.74rem;">Status: ' + (isGranted ? '<span style="color:#30d158;font-weight:600">Enabled ✅</span>' : '<span style="color:#ff9f0a;font-weight:600">Permission needed</span>') + '</span>' +
              '</div>' +
            '</div>' +
            (!isGranted ? '<button class="btn-primary xs" id="enableNotifBtn" style="padding:6px 12px;font-size:.76rem;border-radius:8px;white-space:nowrap;"><i class="fas fa-bell"></i> Enable</button>' : '') +
          '</div>' +

          (isIOS ?
            '<div style="background:rgba(255,159,10,.08);border:1px solid rgba(255,159,10,.25);border-radius:12px;padding:9px 12px;font-size:.76rem;color:#ffb340;">' +
              '<i class="fab fa-apple"></i> <strong>iPhone Tip:</strong> Add to Home Screen (Share ➔ "Add to Home Screen") for the most reliable background uploads without iOS browser memory limits.' +
            '</div>' : '') +
        '</div>' +

        '<div style="display:flex;justify-content:flex-end;gap:8px;">' +
          '<button class="btn-primary sm" id="closeBgModalBtn" style="border-radius:10px;padding:.5rem 1.2rem;">Got It</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    function cleanup() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    const closeBtn = overlay.querySelector('#closeBgModalBtn');
    if (closeBtn) closeBtn.onclick = cleanup;
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) cleanup(); });

    const notifBtn = overlay.querySelector('#enableNotifBtn');
    if (notifBtn) {
      notifBtn.onclick = async function () {
        notifBtn.disabled = true;
        notifBtn.textContent = 'Requesting…';
        await requestNotificationPermission();
        cleanup();
        showMobileBackgroundUploadDialog();
      };
    }
  }

  // ─── 6. Register Service Worker Automatically ───
  if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').then(function (reg) {
        console.log('TeleDrive ServiceWorker registered:', reg.scope);
      }).catch(function (err) {
        console.warn('TeleDrive ServiceWorker notice:', err);
      });
    });
  }

  // Expose to window for upload modules
  window.TeleDriveMobileBg = {
    startKeepAlive: startMobileKeepAlive,
    stopKeepAlive: stopMobileKeepAlive,
    updateProgress: onUploadProgressTick,
    finishUpload: onUploadFinished,
    requestNotificationPermission: requestNotificationPermission,
    showDialog: showMobileBackgroundUploadDialog
  };

})(window);
