// ============================================================
// 15-lxmusic-free-source.js — lxmusic 免费音源 fallback
// Runs AFTER 13-playback-start-audio.js (playQueueAt) and
// 11-provider-fallback.js (recovery machinery, showSourceFallbackNotice).
// All globals from earlier modules are available via concatenation.
// ============================================================

// --- 文件日志辅助 ---
function _lxFreeLog(category, message, data) {
  try {
    fetch('/api/lxmusic/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: category, message: message, data: data }),
    }).catch(function () {});
  } catch (_) {}
}

var lxFreeStatusCache = null;
var lxFreeStatusCacheAt = 0;
var lxFreeStatusCacheTtlMs = 60000;

var currentPlaybackFreeSource = null;

function lxmusicFreeSourceActive() {
  var now = Date.now();
  if (lxFreeStatusCache && (now - lxFreeStatusCacheAt) < lxFreeStatusCacheTtlMs) {
    return !!(lxFreeStatusCache.enabled && lxFreeStatusCache.backendsUp > 0);
  }
  // NOTE: fetch is fire-and-forget for cache fill; synchronous return uses stale cache.
  // The async fetch updates the cache for the NEXT call. This avoids blocking the
  // hot path while still making the status available within one second of first call.
  var p = null;
  try {
    p = fetch('/api/lxmusic/status').then(function (res) { return res.json(); }).then(function (status) {
      if (status && typeof status === 'object') {
        lxFreeStatusCache = status;
        lxFreeStatusCacheAt = Date.now();
      }
    }).catch(function () {
      // Keep stale cache on fetch failure; do not cache the failure state.
    });
  } catch (e) {
    // fetch not available — leave cache as-is.
  }
  // If we already have a fresh cache, return it even during the background refresh.
  if (lxFreeStatusCache && (now - lxFreeStatusCacheAt) < lxFreeStatusCacheTtlMs) {
    return !!(lxFreeStatusCache.enabled && lxFreeStatusCache.backendsUp > 0);
  }
  // No valid cache yet — fire the fetch synchronously and wait briefly.
  // In practice the first call will be async via the calling function's await.
  return false;
}

// Prefetch status asynchronously so the NEXT call has it cached.
var lxFreePrefetched = false;
(function lxFreePrefetchStatus() {
  if (lxFreePrefetched) return;
  lxFreePrefetched = true;
  try {
    fetch('/api/lxmusic/status').then(function (res) { return res.json(); }).then(function (status) {
      if (status && typeof status === 'object') {
        lxFreeStatusCache = status;
        lxFreeStatusCacheAt = Date.now();
      }
    }).catch(function () { });
  } catch (e) { }
})();

var lxFreeTriggerCategories = [
  'vip_required',
  'paid_required',
  'trial_only',
  'copyright_unavailable',
  'url_unavailable'
];

var lxFreeMaxAttempts = 2;

async function tryLxMusicFreeFallback(song, data, idx, token, opts) {
  _lxFreeLog('TRIGGER', '免费音源触发', { name: song && (song.name || song.title), artist: song && song.artist, manual: !!(opts && opts._lxFreeManual) });
  console.log('[LxFreeFallback] triggered for:', song && (song.name || song.title), 'manual:', !!(opts && opts._lxFreeManual));

  // --- Guard 1: fallback depth ---
  if (opts && opts.fallbackDepth > 0) {
    _lxFreeLog('GUARD', 'blocked: fallbackDepth > 0');
    console.log('[LxFreeFallback] blocked: fallbackDepth > 0');
    return null;
  }

  // --- Guard 2: unsupported song types ---
  if (!song || song.type === 'local' || song.type === 'podcast' || song.source === 'podcast') {
    _lxFreeLog('GUARD', 'blocked: unsupported song type', { type: song && song.type, source: song && song.source });
    console.log('[LxFreeFallback] blocked: unsupported song type');
    return null;
  }

  // --- Guard 3: free source not active ---
  // Manual override bypasses the online check — user explicitly chose free source.
  var manualOverride = !!(opts && opts._lxFreeManual);
  var activeNow = false;
  if (lxFreeStatusCache && (Date.now() - lxFreeStatusCacheAt) < lxFreeStatusCacheTtlMs) {
    activeNow = !!(lxFreeStatusCache.enabled && lxFreeStatusCache.backendsUp > 0);
    _lxFreeLog('GUARD', '状态缓存', { backendsUp: lxFreeStatusCache.backendsUp, enabled: lxFreeStatusCache.enabled, activeNow: activeNow });
    console.log('[LxFreeFallback] status cache:', lxFreeStatusCache.backendsUp, 'backends up');
  } else {
    // Synchronously wait for a fresh status fetch (blocking but bounded by server timeout).
    try {
      var statusResp = await fetch('/api/lxmusic/status');
      var statusJson = await statusResp.json();
      if (statusJson && typeof statusJson === 'object') {
        lxFreeStatusCache = statusJson;
        lxFreeStatusCacheAt = Date.now();
        activeNow = !!(statusJson.enabled && statusJson.backendsUp > 0);
        _lxFreeLog('GUARD', '状态实时查询', { backendsUp: statusJson.backendsUp, enabled: statusJson.enabled, activeNow: activeNow });
        console.log('[LxFreeFallback] status fresh:', statusJson.backendsUp, 'backends up');
      }
    } catch (e) {
      // Fetch failed — cache miss, treat as inactive.
      activeNow = false;
      _lxFreeLog('ERROR', '状态查询失败', { error: e.message });
    }
  }
  if (!activeNow && !manualOverride) {
    _lxFreeLog('GUARD', 'blocked: no backends up');
    console.log('[LxFreeFallback] blocked: no backends up');
    return null;
  }

  // --- Guard 4: trigger gate — require explicit server restriction ---
  if (!(
    data
    && data.restriction
    && data.restriction.category
    && lxFreeTriggerCategories.indexOf(data.restriction.category) >= 0
  )) {
    _lxFreeLog('GUARD', 'blocked: no trigger category', { restriction: data && data.restriction, category: data && data.restriction && data.restriction.category });
    return null;
  }

  // --- Budget: recovery check ---
  var recovery = (typeof sourceFallbackRecoveryFromOptions === 'function')
    ? sourceFallbackRecoveryFromOptions(opts)
    : null;
  if (recovery && (typeof sourceFallbackRecoveryCanContinue === 'function') && !sourceFallbackRecoveryCanContinue(recovery)) {
    return null;
  }

  // --- Build resolve URL ---
  var providerKey = (typeof songProviderKey === 'function') ? songProviderKey(song) : 'netease';
  var quality = (typeof normalizePlaybackQualityForProvider === 'function')
    ? normalizePlaybackQualityForProvider(
        (opts && opts.qualityOverride) || ((typeof getProviderPlaybackQuality === 'function') ? getProviderPlaybackQuality(providerKey) : 'hires'),
        'lxmusic'
      )
    : 'hires';

  var resolveParams = new URLSearchParams();
  resolveParams.set('provider', providerKey);
  resolveParams.set('id', song.id || '');
  resolveParams.set('mid', song.mid || '');
  resolveParams.set('songmid', song.songmid || '');
  resolveParams.set('hash', song.hash || '');
  resolveParams.set('mixSongId', song.mixSongId || '');
  resolveParams.set('name', song.name || song.title || '');
  resolveParams.set('artist', song.artist || '');
  resolveParams.set('duration', String(song.duration || ''));
  resolveParams.set('quality', quality);
  // Pass selected backend if configured
  if (lxmusicSelectedBackend) {
    resolveParams.set('backend', lxmusicSelectedBackend);
  }

  // --- Attempt loop (up to lxFreeMaxAttempts; retry adds nocache) ---
  for (var lxFreeAttempt = 0; lxFreeAttempt < lxFreeMaxAttempts; lxFreeAttempt++) {
    var lxFreeUrl = '/api/lxmusic/resolve?' + resolveParams.toString();
    if (lxFreeAttempt > 0) {
      lxFreeUrl += '&nocache=1';
    }

    _lxFreeLog('RESOLVE', '第' + (lxFreeAttempt + 1) + '次尝试', { url: lxFreeUrl });
    console.log('[LxFreeFallback] attempt ' + lxFreeAttempt + ' url:', lxFreeUrl);

    var lxFreeResult;
    try {
      lxFreeResult = await apiJson(lxFreeUrl, { timeoutMs: 10000 });
      _lxFreeLog('RESOLVE', '解析结果', { playable: lxFreeResult && lxFreeResult.playable, url: lxFreeResult && lxFreeResult.url ? lxFreeResult.url.substring(0, 120) : 'NONE', backend: lxFreeResult && lxFreeResult.backend, quality: lxFreeResult && lxFreeResult.quality, reason: lxFreeResult && lxFreeResult.reason });
      console.log('[LxFreeFallback] result:', lxFreeResult);
    } catch (lxFreeFetchErr) {
      _lxFreeLog('ERROR', '请求失败', { error: lxFreeFetchErr.message, attempt: lxFreeAttempt });
      // Network or JSON parse failure — if this was the first attempt, retry; otherwise give up.
      if (lxFreeAttempt === 0) continue;
      return null;
    }

    if (!lxFreeResult || lxFreeResult.playable !== true) {
      _lxFreeLog('RESOLVE', '不可播放', { result: lxFreeResult });
      // Not playable — if first attempt, retry with nocache; otherwise give up.
      if (lxFreeAttempt === 0) continue;
      return null;
    }

    // --- Playable: record source and play ---
    currentPlaybackFreeSource = {
      backend: lxFreeResult.backend,
      quality: lxFreeResult.quality,
      level: lxFreeResult.level
    };

    var lxFreePlayOpts = Object.assign({}, opts, {
      fallbackDepth: 1,
      preResolvedPlaybackData: {
        url: lxFreeResult.url,
        level: lxFreeResult.level,
        quality: lxFreeResult.quality,
        provider: 'lxmusic',
        backend: lxFreeResult.backend
      },
      freeSourceResolved: true,
      resumeAt: (opts && opts.resumeAt)
    });

    var lxFreeStarted = await playQueueAt(idx, lxFreePlayOpts);

    if (lxFreeStarted === true) {
      _lxFreeLog('PLAYBACK', '免费音源播放成功', { name: song && (song.name || song.title), backend: lxFreeResult.backend, quality: lxFreeResult.quality });
      // 立即更新按钮显示为实际使用的后端名
      if (typeof updateFreeSourceButton === 'function') updateFreeSourceButton();
      if (!(opts && opts.startupAutoplay)) {
        if (typeof showSourceFallbackNotice === 'function') {
          var lxFreeQualityLabel = (typeof playbackQualityLabel === 'function')
            ? playbackQualityLabel(lxFreeResult.quality, 'lxmusic')
            : (lxFreeResult.quality || '');
          showSourceFallbackNotice(
            '免费音源播放',
            (song.name || '当前歌曲') + ' 已通过免费音源播放（' + lxFreeQualityLabel + '）。'
          );
        }
      }
      return true;
    }

    _lxFreeLog('PLAYBACK', 'playQueueAt 返回 false', { name: song && (song.name || song.title) });
    // --- playQueueAt returned false — retry with nocache if first attempt ---
    currentPlaybackFreeSource = null;
    if (lxFreeAttempt === 0) continue;
    return null;
  }

  // Should not reach here, but safety net.
  currentPlaybackFreeSource = null;
  return null;
}

// ============================================================
// Free Source Dropdown — source selection in control bar
// ============================================================

var freeSourceManualOverride = false;
var selectedFreeSource = 'official'; // 'official' or backend id

function getCurrentPlayingSong() {
  try {
    if (typeof playQueue !== 'undefined' && typeof currentIdx !== 'undefined' && playQueue && currentIdx >= 0 && currentIdx < playQueue.length) {
      return playQueue[currentIdx];
    }
  } catch (e) {}
  return null;
}

function updateFreeSourceButton() {
  var dropdown = document.getElementById('free-source-dropdown');
  var btn = document.getElementById('free-source-btn');
  var label = document.getElementById('free-source-label');
  var menu = document.getElementById('free-source-menu');
  if (!dropdown || !btn) return;
  
  var song = getCurrentPlayingSong();
  var hasBackends = !!(lxFreeStatusCache && lxFreeStatusCache.backends && lxFreeStatusCache.backends.length > 0);
  
  if (song && hasBackends) {
    dropdown.style.display = '';
    
    // 更新当前播放源显示
    if (currentPlaybackFreeSource && currentPlaybackFreeSource.backend) {
      // 使用免费音源播放
      var backendName = getBackendName(currentPlaybackFreeSource.backend);
      label.textContent = backendName;
      btn.classList.add('active');
    } else {
      // 使用官方源播放
      label.textContent = '官方';
      btn.classList.remove('active');
    }
    
    // 更新下拉菜单中的后端列表
    updateBackendMenuItems(menu);
  } else {
    dropdown.style.display = 'none';
    freeSourceManualOverride = false;
    selectedFreeSource = 'official';
  }
}

function getBackendName(backendId) {
  if (!lxFreeStatusCache || !lxFreeStatusCache.backends) return backendId;
  var backend = lxFreeStatusCache.backends.find(function(b) { return b.id === backendId; });
  return backend ? backend.name : backendId;
}

function updateBackendMenuItems(menu) {
  if (!menu || !lxFreeStatusCache || !lxFreeStatusCache.backends) return;
  
  // 找到分隔线和头部
  var divider = menu.querySelector('.free-source-menu-divider');
  var header = menu.querySelector('.free-source-menu-header');
  
  // 移除旧的后端选项（保留官方、分隔线、头部）
  var oldItems = menu.querySelectorAll('.free-source-menu-item:not([data-source="official"])');
  oldItems.forEach(function(item) { item.remove(); });
  
  // 添加新的后端选项
  lxFreeStatusCache.backends.forEach(function(backend) {
    if (backend.enabled === false) return;
    var item = document.createElement('div');
    item.className = 'free-source-menu-item';
    item.setAttribute('data-source', backend.id);
    item.onclick = function(e) { selectFreeSource(backend.id, e); };
    
    var icon = document.createElement('span');
    icon.className = 'free-source-icon';
    icon.textContent = backend.reachable === true ? '🟢' : '⚪';
    
    var name = document.createElement('span');
    name.className = 'free-source-name';
    name.textContent = backend.name;
    
    var status = document.createElement('span');
    status.className = 'free-source-status';
    status.textContent = backend.reachable === true ? '可用' : '离线';
    
    item.appendChild(icon);
    item.appendChild(name);
    item.appendChild(status);
    menu.appendChild(item);
  });
}

function toggleFreeSourceDropdown(event) {
  if (event) event.stopPropagation();
  var dropdown = document.getElementById('free-source-dropdown');
  if (!dropdown) return;
  
  var isOpen = dropdown.classList.contains('open');
  if (isOpen) {
    dropdown.classList.remove('open');
  } else {
    dropdown.classList.add('open');
    // 点击外部关闭菜单
    setTimeout(function() {
      document.addEventListener('click', closeFreeSourceMenu, { once: true });
    }, 0);
  }
}

function closeFreeSourceMenu() {
  var dropdown = document.getElementById('free-source-dropdown');
  if (dropdown) dropdown.classList.remove('open');
}

function selectFreeSource(source, event) {
  if (event) event.stopPropagation();
  closeFreeSourceMenu();
  
  selectedFreeSource = source;
  freeSourceManualOverride = (source !== 'official');
  
  _lxFreeLog('BUTTON', '选择音源', { source: source, manual: freeSourceManualOverride });
  updateFreeSourceButton();
  
  if (freeSourceManualOverride) {
    if (typeof showToast === 'function') showToast('已切换到免费音源，正在重新播放...');
    var song = getCurrentPlayingSong();
    _lxFreeLog('BUTTON', '手动触发播放', { name: song && (song.name || song.title), idx: typeof currentIdx !== 'undefined' ? currentIdx : 'N/A' });
    if (song && typeof playQueueAt === 'function' && typeof currentIdx !== 'undefined') {
      var overrideOpts = { freeSourceResolved: false, _lxFreeManual: true };
      playQueueAt(currentIdx, overrideOpts);
    }
  } else {
    if (typeof showToast === 'function') showToast('已切换到官方音源');
    // 重新播放当前歌曲（使用官方源）
    var song = getCurrentPlayingSong();
    if (song && typeof playQueueAt === 'function' && typeof currentIdx !== 'undefined') {
      playQueueAt(currentIdx, {});
    }
  }
}

// Update button visibility when song changes
var _prevFreeSourceSongId = null;
function _checkFreeSourceButtonUpdate() {
  var song = getCurrentPlayingSong();
  var songId = song ? song.id : null;
  if (songId !== _prevFreeSourceSongId) {
    _prevFreeSourceSongId = songId;
    freeSourceManualOverride = false;
    selectedFreeSource = 'official';
    updateFreeSourceButton();
  }
}
setInterval(_checkFreeSourceButtonUpdate, 1000);
