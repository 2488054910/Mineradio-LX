function loggedProviderCount() {
  return ['netease', 'qq', 'kugou', 'qishui', 'spotify'].filter(function (key) { return hasPlatformLogin(key); }).length;
}
function updateUserModalUi() {
  if (activeAccountProvider !== 'lxmusic') {
    if (!activeAccountProvider || !hasPlatformLogin(activeAccountProvider)) {
      activeAccountProvider = firstLoggedProvider();
      if (!activeAccountProvider) activeAccountProvider = 'lxmusic';
    }
  }
  // lxmusic pane visibility
  var pane = document.getElementById('login-lxmusic-pane');
  if (pane) {
    if (activeAccountProvider === 'lxmusic') {
      pane.removeAttribute('hidden');
      pane.style.display = '';
      renderLxMusicPane();
    } else {
      pane.setAttribute('hidden', '');
      pane.style.display = 'none';
    }
  }
}
function showUserModal() {
  showLoginModal();
}
function closeUserModal() { closeLoginModal(); }
function setActiveAccountProvider(provider) {
  if (provider === 'lxmusic') { activeAccountProvider = 'lxmusic'; dualAccountMode = false; renderUserBtn(); updateUserModalUi(); return; }
  provider = provider === 'qq' ? 'qq' : (provider === 'kugou' ? 'kugou' : (provider === 'qishui' ? 'qishui' : (provider === 'spotify' ? 'spotify' : 'netease')));
  if (!hasPlatformLogin(provider)) {
    openProviderLogin(provider);
    return;
  }
  activeAccountProvider = provider;
  dualAccountMode = false;
  renderUserBtn();
  updateUserModalUi();
}
function enableDualAccountView() {
  if (loggedProviderCount() < 2) {
    openProviderLogin(firstLoggedProvider() === 'netease' ? 'qq' : 'netease');
    return;
  }
  dualAccountMode = true;
  renderUserBtn();
  updateUserModalUi();
  showToast('已启用多平台账号展示');
}
function requestDualLoginMode() {
  enableDualAccountView();
}
function openProviderLogin(provider) {
  provider = provider === 'qq' ? 'qq' : (provider === 'kugou' ? 'kugou' : (provider === 'qishui' ? 'qishui' : (provider === 'spotify' ? 'spotify' : 'netease')));
  closeUserModal();
  loginProvider = provider;
  showLoginModal({ provider: provider });
}

var logoutAllAccountsResetBusy = false;
var logoutAllAccountsResetConfirmUntil = 0;
var logoutAllAccountsResetConfirmTimer = null;

function clearLogoutAllAccountsResetConfirmation() {
  logoutAllAccountsResetConfirmUntil = 0;
  if (logoutAllAccountsResetConfirmTimer) {
    window.clearTimeout(logoutAllAccountsResetConfirmTimer);
    logoutAllAccountsResetConfirmTimer = null;
  }
  var button = document.getElementById('login-reset-all-btn');
  if (button) {
    button.classList.remove('confirming');
    if (!logoutAllAccountsResetBusy) button.textContent = '退出登录';
  }
}

function armLogoutAllAccountsResetConfirmation() {
  logoutAllAccountsResetConfirmUntil = Date.now() + 5000;
  var button = document.getElementById('login-reset-all-btn');
  if (button) {
    button.classList.add('confirming');
    button.textContent = '再次点击确认';
  }
  if (typeof showToast === 'function') showToast('再次点击"退出登录"以清除全部平台 Cookie');
  if (logoutAllAccountsResetConfirmTimer) window.clearTimeout(logoutAllAccountsResetConfirmTimer);
  logoutAllAccountsResetConfirmTimer = window.setTimeout(clearLogoutAllAccountsResetConfirmation, 5000);
}

function resetAllProviderRendererLoginState() {
  loginStatus = { loggedIn: false, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP' };
  qqLoginStatus = { provider: 'qq', loggedIn: false, preview: false, nickname: 'QQ 音乐', userId: '', avatar: '', vipType: 0, vipLevel: 'none', isVip: false, isSvip: false };
  kugouLoginStatus = { provider: 'kugou', loggedIn: false, preview: false, nickname: '酷狗音乐', userId: '', avatar: '', vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, playbackKeyReady: false };
  qishuiLoginStatus = { provider: 'qishui', loggedIn: false, configured: false, oauthConfigured: false, oauthMissing: [], preview: false, nickname: '汽水音乐', userId: '', avatar: '', vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, playbackKeyReady: false, playbackMode: 'recommend-match' };
  spotifyLoginStatus = { provider: 'spotify', loggedIn: false, configured: false, oauthConfigured: false, oauthMissing: [], preview: false, nickname: 'Spotify', userId: '', avatar: '', product: '', vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, playbackKeyReady: false, playbackMode: 'recommend-match', tokenConfigured: false, tokenFileExists: false, credentialsFileExists: false, localConfigMissing: false };
  loginStatusChecked = true;
  loginStatusCheckFailed = false;
  neteasePlaylists = [];
  qqPlaylists = [];
  kugouPlaylists = [];
  qishuiPlaylists = [];
  spotifyPlaylists = [];
  userPlaylists = [];
  myPodcastCollections = [];
  myPodcastItems = {};
  likedSongMap = {};
  dualAccountMode = false;
  activeAccountProvider = 'netease';
  playlistCatalogRevision += 1;
  if (typeof clearQQPlaybackVipEvidence === 'function') clearQQPlaybackVipEvidence();
  if (typeof homeDiscoverState !== 'undefined' && homeDiscoverState) {
    homeDiscoverState.loading = false;
    homeDiscoverState.loaded = true;
    homeDiscoverState.loggedIn = false;
    homeDiscoverState.mode = 'starter';
    homeDiscoverState.songs = [];
    homeDiscoverState.playlists = [];
    homeDiscoverState.podcasts = [];
  }
}

async function logoutAllAccountsAndResetEasterEgg() {
  if (logoutAllAccountsResetBusy) return;
  if (Date.now() > logoutAllAccountsResetConfirmUntil) {
    armLogoutAllAccountsResetConfirmation();
    return;
  }
  logoutAllAccountsResetBusy = true;
  var button = document.getElementById('login-reset-all-btn');
  clearLogoutAllAccountsResetConfirmation();
  if (button) {
    button.disabled = true;
    button.textContent = '正在清除…';
  }
  try {
    await Promise.allSettled([
      apiJson('/api/logout'),
      apiJson('/api/qq/logout'),
      apiJson('/api/kugou/logout'),
      apiJson('/api/qishui/logout'),
      apiJson('/api/spotify/logout')
    ]);
    var result = await requestLoginEasterEggReplayReset();
    if (!result || !result.ok || result.unlocked || result.resetComplete === false) {
      throw new Error(result && (result.error || result.message) || 'LOGIN_EASTER_EGG_REPLAY_RESET_FAILED');
    }
    resetAllProviderRendererLoginState();
    resetLoginEasterEggUiForReplay();
    closeCollectModal();
    closeUserModal();
    closeLoginModal();
    updateLikeButtons();
    safeRenderQueuePanel('logout-all-reset', { scrollCurrent: miniQueueOpen });
    renderUserBtn();
    safeShelfRebuild('logout-all-reset');
    homeSuppressed = false;
    homeForcedOpen = true;
    if (typeof setHomeControlsLocked === 'function') setHomeControlsLocked(true);
    if (typeof updateEmptyHomeVisibility === 'function') updateEmptyHomeVisibility({ forceLoad: false });
    if (typeof renderHomeDashboard === 'function') renderHomeDashboard();
    showToast('已退出全部账号，登录彩蛋已重新开启');
  } catch (error) {
    console.warn('Logout all accounts and reset easter egg failed:', error);
    showToast('清理未完成，请重启后重试');
  } finally {
    logoutAllAccountsResetBusy = false;
    if (button) {
      button.disabled = false;
      button.classList.remove('confirming');
      button.textContent = '退出登录';
    }
  }
}

async function logoutActiveAccount() {
  if (activeAccountProvider === 'lxmusic') { closeUserModal(); return; }
  if (activeAccountProvider === 'spotify') {
    try { await apiJson('/api/spotify/logout'); } catch (e) { }
    try {
      if (window.desktopWindow && typeof window.desktopWindow.clearSpotifyMusicLogin === 'function') {
        await window.desktopWindow.clearSpotifyMusicLogin();
      }
    } catch (e) { }
    spotifyLoginStatus = { provider: 'spotify', loggedIn: false, configured: false, oauthConfigured: false, oauthMissing: [], preview: false, nickname: 'Spotify', userId: '', avatar: '', product: '', vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, playbackKeyReady: false, playbackMode: 'recommend-match', tokenConfigured: false, tokenFileExists: false, credentialsFileExists: false, localConfigMissing: false };
    spotifyPlaylists = [];
    userPlaylists = userPlaylists.filter(function (pl) { return pl.provider !== 'spotify'; });
    playlistCatalogRevision += 1;
    dualAccountMode = false;
    activeAccountProvider = firstLoggedProvider();
    renderUserBtn();
    safeShelfRebuild('spotify-logout');
    if (hasAnyPlatformLogin()) updateUserModalUi();
    else closeUserModal();
    showToast('已退出 Spotify');
    return;
  }
  if (activeAccountProvider === 'qishui') {
    try { await apiJson('/api/qishui/logout'); } catch (e) { }
    try {
      if (window.desktopWindow && typeof window.desktopWindow.clearQishuiMusicLogin === 'function') {
        await window.desktopWindow.clearQishuiMusicLogin();
      }
    } catch (e) { }
    qishuiLoginStatus = { provider: 'qishui', loggedIn: false, configured: false, oauthConfigured: false, oauthMissing: [], preview: false, nickname: '汽水音乐', userId: '', avatar: '', vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, playbackKeyReady: false, playbackMode: 'recommend-match' };
    qishuiPlaylists = [];
    userPlaylists = userPlaylists.filter(function (pl) { return pl.provider !== 'qishui'; });
    playlistCatalogRevision += 1;
    dualAccountMode = false;
    activeAccountProvider = firstLoggedProvider();
    renderUserBtn();
    safeShelfRebuild('qishui-logout');
    if (hasAnyPlatformLogin()) updateUserModalUi();
    else closeUserModal();
    showToast('已清除汽水音乐授权');
    return;
  }
  if (activeAccountProvider === 'kugou') {
    try { await apiJson('/api/kugou/logout'); } catch (e) { }
    try {
      if (window.desktopWindow && typeof window.desktopWindow.clearKugouMusicLogin === 'function') {
        await window.desktopWindow.clearKugouMusicLogin();
      }
    } catch (e) { }
    kugouLoginStatus = { provider: 'kugou', loggedIn: false, preview: false, nickname: '酷狗音乐', userId: '', avatar: '', vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, playbackKeyReady: false };
    kugouPlaylists = [];
    userPlaylists = userPlaylists.filter(function (pl) { return pl.provider !== 'kugou'; });
    playlistCatalogRevision += 1;
    dualAccountMode = false;
    activeAccountProvider = firstLoggedProvider();
    renderUserBtn();
    if (hasAnyPlatformLogin()) updateUserModalUi();
    else closeUserModal();
    showToast('已退出酷狗音乐');
    return;
  }
  if (activeAccountProvider === 'qq') {
    try { await apiJson('/api/qq/logout'); } catch (e) { }
    try {
      if (window.desktopWindow && typeof window.desktopWindow.clearQQMusicLogin === 'function') {
        await window.desktopWindow.clearQQMusicLogin();
      }
    } catch (e) { }
    if (typeof clearQQPlaybackVipEvidence === 'function') clearQQPlaybackVipEvidence();
    qqLoginStatus = { provider: 'qq', loggedIn: false, preview: false, nickname: 'QQ 音乐', userId: '', avatar: '', vipType: 0, vipLevel: 'none', isVip: false, isSvip: false };
    qqPlaylists = [];
    userPlaylists = userPlaylists.filter(function (pl) { return pl.provider !== 'qq'; });
    playlistCatalogRevision += 1;
    dualAccountMode = false;
    activeAccountProvider = firstLoggedProvider();
    renderUserBtn();
    if (hasAnyPlatformLogin()) updateUserModalUi();
    else closeUserModal();
    showToast('已退出 QQ 音乐');
    return;
  }
  doLogout();
}
async function doLogout() {
  await apiJson('/api/logout');
  try {
    if (window.desktopWindow && typeof window.desktopWindow.clearNeteaseMusicLogin === 'function') {
      await window.desktopWindow.clearNeteaseMusicLogin();
    }
  } catch (e) { }
  loginStatus = { loggedIn: false };
  neteasePlaylists = [];
  if (!hasPlatformLogin('netease') || loggedProviderCount() < 2) dualAccountMode = false;
  activeAccountProvider = firstLoggedProvider();
  userPlaylists = qqPlaylists.concat(kugouPlaylists || [], qishuiPlaylists || [], spotifyPlaylists || []);
  playlistCatalogRevision += 1;
  myPodcastCollections = [];
  myPodcastItems = {};
  likedSongMap = {};
  closeCollectModal();
  updateLikeButtons();
  safeRenderQueuePanel('logout', { scrollCurrent: miniQueueOpen });
  renderUserBtn();
  safeShelfRebuild('logout');
  closeUserModal();
  showToast('已退出登录');
}

function maskLxKey(key) {
  key = String(key || '');
  if (key.length <= 2) return '•••';
  return '•••' + key.slice(-2);
}

var lxmusicSelectedBackend = null;

function renderLxMusicPane() {
  var pane = document.getElementById('login-lxmusic-pane');
  if (!pane) return;
  pane.removeAttribute('hidden');
  pane.style.display = '';
  var statusEl = document.getElementById('lxmusic-status-text');
  var listEl = document.getElementById('lxmusic-backend-list');
  if (!listEl) return;
  listEl.textContent = '加载中...';

  // Show add-backend section
  var addSection = pane.querySelector('.lxmusic-add-section');
  if (addSection) addSection.style.display = '';

  try {
    fetch('/api/lxmusic/status').then(function (res) { return res.json(); }).then(function (status) {
      if (!pane.parentNode || !listEl) return;
      var backends = status && status.backends || [];
      var backendsUp = backends.filter(function (b) { return b.reachable; }).length;
      if (statusEl) statusEl.textContent = '已配置 ' + backends.length + ' 个后端，' + backendsUp + ' 个在线';

      // Load selected backend from server config
      if (status.selectedBackend) lxmusicSelectedBackend = status.selectedBackend;

      listEl.textContent = '';
      if (!backends.length) {
        listEl.textContent = '暂无后端';
        return;
      }

      // Auto-select first online backend if none selected
      if (!lxmusicSelectedBackend) {
        var firstOnline = backends.find(function (b) { return b.reachable; });
        if (firstOnline) lxmusicSelectedBackend = firstOnline.id;
      }

      backends.forEach(function (b) {
        var row = document.createElement('div');
        row.className = 'lxmusic-backend-row' + (lxmusicSelectedBackend === b.id ? ' selected' : '');
        row.style.cursor = 'pointer';
        row.style.padding = '10px 12px';
        row.style.borderRadius = '8px';
        row.style.marginBottom = '6px';
        row.style.background = lxmusicSelectedBackend === b.id ? 'rgba(244,210,138,0.15)' : 'rgba(255,255,255,0.05)';
        row.style.border = lxmusicSelectedBackend === b.id ? '1px solid rgba(244,210,138,0.4)' : '1px solid rgba(255,255,255,0.1)';
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '10px';

        // Radio button
        var radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'lxmusic-backend-select';
        radio.value = b.id;
        radio.checked = lxmusicSelectedBackend === b.id;
        radio.style.cursor = 'pointer';
        row.appendChild(radio);

        // Name
        var nameSpan = document.createElement('span');
        nameSpan.textContent = (b.name || b.id || '');
        nameSpan.style.flex = '1';
        nameSpan.style.color = '#fff';
        row.appendChild(nameSpan);

        // Status dot
        var dotSpan = document.createElement('span');
        dotSpan.className = 'lxmusic-backend-status ' + (b.reachable ? 'reachable' : 'unreachable');
        dotSpan.textContent = b.reachable ? '在线' : '离线';
        dotSpan.style.fontSize = '12px';
        dotSpan.style.color = b.reachable ? '#4ade80' : '#f87171';
        row.appendChild(dotSpan);

        // Click handler
        row.addEventListener('click', function () {
          lxmusicSelectedBackend = b.id;
          // Save selection to config
          fetch('/api/lxmusic/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ selectedBackend: b.id })
          }).catch(function () {});
          renderLxMusicPane();
          if (typeof showToast === 'function') showToast('已选择 ' + (b.name || b.id));
        });

        listEl.appendChild(row);
      });
    }).catch(function () {
      if (listEl && listEl.textContent === '加载中...') listEl.textContent = '加载失败';
    });
  } catch (e) {
    if (listEl) listEl.textContent = '加载失败';
  }
}

function toggleAddBackendForm() {
  var form = document.getElementById('lxmusic-add-form');
  if (!form) return;
  var h4 = form.previousElementSibling;
  if (form.style.display === 'none') {
    form.style.display = '';
    if (h4) h4.textContent = '添加音源 ▾';
  } else {
    form.style.display = 'none';
    if (h4) h4.textContent = '添加音源 ▸';
  }
}

function lxmusicPostConfig(input) {
  return fetch('/api/lxmusic/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  }).then(function (res) { return res.json(); });
}

function lxmusicAddBackend() {
  var urlEl = document.getElementById('lxmusic-add-url');
  if (!urlEl) return;
  var url = String(urlEl.value || '').trim();
  if (!url) {
    if (typeof showToast === 'function') showToast('请输入音源地址');
    return;
  }
  // 自动生成 ID 和名称
  var id = 'source_' + Date.now();
  var name = url.replace(/^https?:\/\//, '').replace(/\/$/, '').substring(0, 30);
  
  fetch('/api/lxmusic/status').then(function (res) { return res.json(); }).then(function (status) {
    var backends = (status && status.backends || []).slice();
    backends.push({
      id: id, name: name, baseUrl: url, style: 'query',
      keyHeader: 'X-Request-Key', key: 'public_source', timeoutMs: 10000,
      qualitys: ['128k', '320k', 'flac', 'flac24bit']
    });
    return lxmusicPostConfig({ backends: backends });
  }).then(function () {
    if (typeof showToast === 'function') showToast('音源已添加');
    renderLxMusicPane();
    if (urlEl) urlEl.value = '';
  }).catch(function (err) {
    if (typeof showToast === 'function') showToast('添加失败: ' + (err && err.message || '未知错误'));
    console.error('[LxMusicAddBackend]', err);
  });
}

// ============================================================
//  Custom Source Modal — 自定义源管理
// ============================================================

var _csSelectedScriptContent = null;

function openCustomSourceModal() {
  closeLoginModal();
  var modal = document.getElementById('custom-source-modal');
  if (modal) {
    modal.classList.add('show');
    renderCustomSourceList();
  }
}

function closeCustomSourceModal() {
  var modal = document.getElementById('custom-source-modal');
  if (modal) modal.classList.remove('show');
}

function switchCustomSourceTab(tab) {
  var tabs = document.querySelectorAll('.custom-source-add-tabs button');
  tabs.forEach(function (btn, i) {
    btn.classList.toggle('active', (tab === 'url' && i === 0) || (tab === 'script' && i === 1));
  });
  var urlContent = document.getElementById('cs-tab-url');
  var scriptContent = document.getElementById('cs-tab-script');
  if (urlContent) urlContent.style.display = tab === 'url' ? '' : 'none';
  if (scriptContent) scriptContent.style.display = tab === 'script' ? '' : 'none';
}

/**
 * Auto-detect backend type by probing the URL.
 * Returns { style, keyHeader, key, name } or null.
 */
async function detectBackendType(url) {
  var base = url.replace(/\/+$/, '');
  // Try chksz style first: /api/163_music?id=test&level=128k
  try {
    var chkszResp = await fetch(base + '/api/163_music?id=0&level=128k', { signal: AbortSignal.timeout(5000) });
    if (chkszResp.ok) {
      return { style: 'chksz', keyHeader: '', key: '', name: 'ChKSz 音源' };
    }
  } catch (_) {}
  // Try query style: /query?id=test&source=wy
  try {
    var queryResp = await fetch(base + '/query?id=0&source=wy', { signal: AbortSignal.timeout(5000) });
    if (queryResp.ok) {
      var queryData = await queryResp.json();
      if (queryData && (queryData.url || queryData.code !== undefined)) {
        return { style: 'query', keyHeader: 'X-Request-Key', key: 'public_source', name: 'Query 音源' };
      }
    }
  } catch (_) {}
  // Try xinghai style: /api/url?source=wy&id=0
  try {
    var xhResp = await fetch(base + '/api/url?source=wy&id=0', { signal: AbortSignal.timeout(5000) });
    if (xhResp.ok) {
      var xhData = await xhResp.json();
      if (xhData && (xhData.data || xhData.url)) {
        return { style: 'xinghai', keyHeader: '', key: '', name: '星海音源' };
      }
    }
  } catch (_) {}
  // Try path style: /wy/url/0/128k
  try {
    var pathResp = await fetch(base + '/wy/url/0/128k', { signal: AbortSignal.timeout(5000) });
    if (pathResp.ok) {
      var pathData = await pathResp.json();
      if (pathData && (pathData.url || pathData.data)) {
        return { style: 'path', keyHeader: 'X-Request-Key', key: 'share-v3', name: 'Path 音源' };
      }
    }
  } catch (_) {}
  // Default: assume query style
  return { style: 'query', keyHeader: 'X-Request-Key', key: 'public_source', name: base.replace(/^https?:\/\//, '').substring(0, 30) };
}

async function addCustomSourceByUrl() {
  var urlEl = document.getElementById('cs-add-url');
  if (!urlEl) return;
  var url = String(urlEl.value || '').trim();
  if (!url) {
    if (typeof showToast === 'function') showToast('请输入音源地址');
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    if (typeof showToast === 'function') showToast('请输入有效的 URL 地址');
    return;
  }
  if (typeof showToast === 'function') showToast('正在识别音源类型…');
  try {
    var detected = await detectBackendType(url);
    var id = 'cs_' + Date.now();
    var name = detected.name || url.replace(/^https?:\/\//, '').replace(/\/$/, '').substring(0, 30);
    var status = await fetch('/api/lxmusic/status').then(function (r) { return r.json(); });
    var backends = (status && status.backends || []).slice();
    // Check duplicate
    if (backends.some(function (b) { return b.baseUrl === url; })) {
      if (typeof showToast === 'function') showToast('该音源已存在');
      return;
    }
    backends.push({
      id: id, name: name, baseUrl: url, style: detected.style,
      keyHeader: detected.keyHeader, key: detected.key, timeoutMs: 10000,
      qualitys: ['128k', '320k', 'flac', 'flac24bit']
    });
    await lxmusicPostConfig({ backends: backends });
    if (typeof showToast === 'function') showToast('音源已添加（' + detected.style + '）');
    urlEl.value = '';
    renderCustomSourceList();
  } catch (err) {
    if (typeof showToast === 'function') showToast('添加失败: ' + (err && err.message || '未知错误'));
  }
}

function handleScriptFileSelect(event) {
  var file = event.target.files && event.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function (e) {
    _csSelectedScriptContent = e.target.result;
    if (typeof showToast === 'function') showToast('脚本已读取: ' + file.name);
  };
  reader.readAsText(file);
}

async function addCustomSourceByScript() {
  var urlEl = document.getElementById('cs-script-url');
  var scriptContent = _csSelectedScriptContent;
  var scriptUrl = urlEl ? String(urlEl.value || '').trim() : '';
  // If URL provided, fetch the script
  if (!scriptContent && scriptUrl) {
    if (typeof showToast === 'function') showToast('正在下载脚本…');
    try {
      var resp = await fetch(scriptUrl, { signal: AbortSignal.timeout(15000) });
      scriptContent = await resp.text();
    } catch (err) {
      if (typeof showToast === 'function') showToast('脚本下载失败: ' + (err.message || ''));
      return;
    }
  }
  if (!scriptContent) {
    if (typeof showToast === 'function') showToast('请提供脚本 URL 或选择本地文件');
    return;
  }
  // Extract source info from script: look for sources object in send('inited', {...})
  var sourcesMatch = scriptContent.match(/send\s*\(\s*['"]inited['"]\s*,\s*\{[\s\S]*?sources\s*:\s*(\{[\s\S]*?\})\s*[,}]/);
  var scriptName = '自定义源脚本';
  var scriptSources = [];
  if (sourcesMatch) {
    // Try to extract source keys like kw/kg/tx/wy/mg
    var srcKeys = sourcesMatch[1].match(/(?:kw|kg|tx|wy|mg)\s*:/g);
    if (srcKeys) scriptSources = srcKeys.map(function (k) { return k.replace(/\s*:/, ''); });
    if (scriptSources.length) scriptName = '自定义源 (' + scriptSources.join('/') + ')';
  }
  // Save script as a special "script" backend entry
  var id = 'script_' + Date.now();
  try {
    var status = await fetch('/api/lxmusic/status').then(function (r) { return r.json(); });
    var backends = (status && status.backends || []).slice();
    backends.push({
      id: id, name: scriptName, baseUrl: 'script://' + id,
      style: 'script', keyHeader: '', key: '', timeoutMs: 10000,
      qualitys: ['128k', '320k', 'flac', 'flac24bit'],
      script: scriptContent,
      scriptSources: scriptSources,
      scriptUrl: scriptUrl || null
    });
    await lxmusicPostConfig({ backends: backends });
    _csSelectedScriptContent = null;
    if (urlEl) urlEl.value = '';
    var fileInput = document.getElementById('cs-script-file');
    if (fileInput) fileInput.value = '';
    if (typeof showToast === 'function') showToast('脚本已导入: ' + scriptName);
    renderCustomSourceList();
  } catch (err) {
    if (typeof showToast === 'function') showToast('导入失败: ' + (err.message || ''));
  }
}

function renderCustomSourceList() {
  var statusEl = document.getElementById('cs-status-text');
  var listEl = document.getElementById('cs-backend-list');
  if (!listEl) return;
  listEl.textContent = '加载中...';
  fetch('/api/lxmusic/status').then(function (res) { return res.json(); }).then(function (status) {
    var backends = status && status.backends || [];
    var backendsUp = backends.filter(function (b) { return b.reachable; }).length;
    if (statusEl) statusEl.textContent = '已配置 ' + backends.length + ' 个音源，' + backendsUp + ' 个在线';
    listEl.textContent = '';
    if (!backends.length) {
      listEl.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.3);padding:20px">暂无音源，请添加</div>';
      return;
    }
    var selectedId = status && status.selectedBackend;
    backends.forEach(function (b) {
      var row = document.createElement('div');
      row.className = 'lxmusic-backend-row' + (selectedId === b.id ? ' selected' : '');
      row.style.cssText = 'cursor:pointer;padding:10px 12px;border-radius:8px;margin-bottom:6px;display:flex;align-items:center;gap:10px;background:' +
        (selectedId === b.id ? 'rgba(244,210,138,0.15)' : 'rgba(255,255,255,0.05)') +
        ';border:1px solid ' + (selectedId === b.id ? 'rgba(244,210,138,0.4)' : 'rgba(255,255,255,0.1)');
      // Radio
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'cs-backend-select';
      radio.checked = selectedId === b.id;
      radio.style.cursor = 'pointer';
      row.appendChild(radio);
      // Name
      var nameSpan = document.createElement('span');
      nameSpan.textContent = (b.name || b.id || '');
      nameSpan.style.cssText = 'flex:1;color:#fff;font-size:13px';
      row.appendChild(nameSpan);
      // Style badge
      var badge = document.createElement('span');
      badge.textContent = b.style || 'query';
      badge.style.cssText = 'font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.5)';
      row.appendChild(badge);
      // Status
      var dot = document.createElement('span');
      dot.textContent = b.reachable ? '在线' : '离线';
      dot.style.cssText = 'font-size:11px;color:' + (b.reachable ? '#4ade80' : '#f87171');
      row.appendChild(dot);
      // Delete button
      var delBtn = document.createElement('button');
      delBtn.textContent = '×';
      delBtn.style.cssText = 'background:none;border:none;color:rgba(255,255,255,0.3);cursor:pointer;font-size:16px;padding:0 4px';
      delBtn.onclick = function (e) {
        e.stopPropagation();
        removeCustomSource(b.id);
      };
      row.appendChild(delBtn);
      // Click to select
      row.addEventListener('click', function () {
        lxmusicPostConfig({ selectedBackend: b.id }).then(function () {
          if (typeof showToast === 'function') showToast('已选择 ' + (b.name || b.id));
          renderCustomSourceList();
        });
      });
      listEl.appendChild(row);
    });
  }).catch(function () {
    if (listEl) listEl.textContent = '加载失败';
  });
}

async function removeCustomSource(backendId) {
  try {
    var status = await fetch('/api/lxmusic/status').then(function (r) { return r.json(); });
    var backends = (status && status.backends || []).filter(function (b) { return b.id !== backendId; });
    await lxmusicPostConfig({ backends: backends });
    if (typeof showToast === 'function') showToast('音源已删除');
    renderCustomSourceList();
  } catch (err) {
    if (typeof showToast === 'function') showToast('删除失败');
  }
}
