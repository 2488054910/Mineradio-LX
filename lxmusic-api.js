'use strict';

// ====================================================================
//  lxmusic-api.js — LX Music free-source multi-backend client
//  CommonJS module. Requires: node:fs, node:path.
//  Uses Electron's net.request for flower backend (HTTP/2 + Chromium TLS
//  fingerprint required by the flower server at 97.64.37.235).

var _debugLog = null;
try { _debugLog = require('./lxmusic-debug-log').logLxMusic; } catch (_) {}
//  No npm dependencies beyond what server.js already bundles.
// ====================================================================

const fs = require('fs');
const path = require('path');

// ---------- Electron net.request wrapper ----------
// The flower backend (97.64.37.235) requires HTTP/2 + Chromium TLS fingerprint.
// Node.js fetch/https uses HTTP/1.1 with a different TLS fingerprint, causing 404.
// Electron's net.request goes through Chromium's network stack (same as lx-music-desktop).

let _net = null;
try {
  // In Electron main process, 'electron' module provides net.request
  // which uses Chromium's network stack (HTTP/2 + Chromium TLS fingerprint)
  const electron = require('electron');
  _net = electron.net || (electron.app && electron.app.isReady && require('electron').net);
} catch (_) {
  // If electron is not available (e.g., running in plain Node.js), fall back to fetch
  _net = null;
}

/**
 * Make an HTTP request using Electron's net.request (Chromium network stack)
 * or fallback to Node.js fetch if Electron is not available.
 *
 * @param {string} url - Request URL
 * @param {Object} options - { method, headers, signal, timeout }
 * @returns {Promise<{ ok: boolean, status: number, json: () => Promise<Object> }>}
 */
function _electronFetch(url, options) {
  return new Promise((resolve, reject) => {
    if (!_net) {
      // Fallback to native fetch if Electron not available
      return fetch(url, options).then(resolve).catch(reject);
    }

    const method = (options && options.method) || 'GET';
    const headers = (options && options.headers) || {};
    const timeoutMs = (options && options.timeout) || 8000;
    const signal = options && options.signal;

    const req = _net.request({
      method: method,
      url: url,
      headers: headers,
    });

    // Handle abort signal
    let aborted = false;
    if (signal) {
      signal.addEventListener('abort', () => {
        aborted = true;
        req.abort();
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    }

    // Set timeout
    const timer = setTimeout(() => {
      if (!aborted) {
        aborted = true;
        req.abort();
        reject(new Error('Request timeout'));
      }
    }, timeoutMs);

    req.on('response', (response) => {
      if (aborted) return;
      clearTimeout(timer);
      const chunks = [];
      response.on('data', (chunk) => {
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (aborted) return;
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          json: () => {
            try {
              return Promise.resolve(JSON.parse(body));
            } catch (e) {
              return Promise.reject(new Error('JSON parse error: ' + e.message));
            }
          },
          text: () => Promise.resolve(body),
        });
      });
    });

    req.on('error', (err) => {
      if (aborted) return;
      clearTimeout(timer);
      reject(err);
    });

    req.end();
  });
}

// ---------- Constants ----------

const CONFIG_FILE = path.join(__dirname, 'data', 'lxmusic-config.json');
const LX_UA = 'lx-music/desktop';

const DEFAULT_CONFIG = {
  enabled: true,
  backends: [
    {
      id: 'xinghai',
      name: '星海音源',
      baseUrl: 'https://yy.zddyr.top',
      style: 'xinghai',
      keyHeader: '',
      key: '',
      timeoutMs: 10000,
      qualitys: ['128k', '320k', 'flac', 'flac24bit'],
    },
    {
      id: 'ikun',
      name: 'ikun 音源',
      baseUrl: 'https://api.ikunshare.com',
      style: 'query',
      keyHeader: 'X-Request-Key',
      key: 'public_source',
      timeoutMs: 8000,
      qualitys: ['128k', '320k'],
    },
    {
      id: 'huibq',
      name: 'Huibq 音源',
      baseUrl: 'https://lxmusicapi.onrender.com',
      style: 'path',
      keyHeader: 'X-Request-Key',
      key: 'share-v3',
      timeoutMs: 8000,
      qualitys: ['128k', '320k'],
    },
  ],
  qualityMap: {
    standard: '128k',
    exhigh: '320k',
    lossless: 'flac',
    hires: 'flac24bit',
    jymaster: 'flac24bit',
  },
};

const QUALITY_ORDER = ['128k', '320k', 'flac', 'flac24bit'];

const CACHE_POSITIVE_TTL = 15 * 60 * 1000; // 15 minutes
const CACHE_NEGATIVE_TTL = 2 * 60 * 1000;  // 2 minutes
const CACHE_MAX = 500;

const THROTTLE_MIN_GAP_MS = 1500;
const THROTTLE_MAX_PER_MIN = 30;

// ---------- Module State ----------

const urlCache = new Map();
const backendThrottle = new Map();
const backendStatus = new Map();

let _configCache = null;
let _configMtime = 0;

// ---------- Config I/O ----------

/**
 * Read the config file. Never throws — returns defaults on any failure.
 * Uses mtime-based caching: only re-reads when the file has changed since
 * the last read.
 */
function getLxMusicConfig() {
  try {
    const stat = fs.statSync(CONFIG_FILE);
    if (_configCache && stat.mtimeMs <= _configMtime) {
      return _configCache;
    }
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    // Basic shape guard: ensure backends is at least an array
    if (!parsed || typeof parsed !== 'object') return DEFAULT_CONFIG;
    if (!Array.isArray(parsed.backends)) parsed.backends = DEFAULT_CONFIG.backends;
    if (!parsed.qualityMap || typeof parsed.qualityMap !== 'object') {
      parsed.qualityMap = DEFAULT_CONFIG.qualityMap;
    }
    _configCache = parsed;
    _configMtime = stat.mtimeMs;
    return parsed;
  } catch (_) {
    return DEFAULT_CONFIG;
  }
}

/**
 * Validate and persist config. Throws Error with .code 'INVALID_LX_CONFIG'
 * on malformed input. Writes atomically (tmp + rename) to the data dir;
 * creates the directory recursively if missing. Returns the saved config.
 */
function saveLxMusicConfig(input) {
  if (!input || typeof input !== 'object') {
    const err = new Error('INVALID_LX_CONFIG: input must be an object');
    err.code = 'INVALID_LX_CONFIG';
    throw err;
  }

  // Reject malformed top-level fields early
  if (input.backends !== undefined && !Array.isArray(input.backends)) {
    const err = new Error('INVALID_LX_CONFIG: backends must be an array');
    err.code = 'INVALID_LX_CONFIG';
    throw err;
  }
  if (input.qualityMap !== undefined && (typeof input.qualityMap !== 'object' || input.qualityMap === null || Array.isArray(input.qualityMap))) {
    const err = new Error('INVALID_LX_CONFIG: qualityMap must be an object');
    err.code = 'INVALID_LX_CONFIG';
    throw err;
  }

  // Merge with existing config to allow partial updates
  let current;
  try {
    current = getLxMusicConfig();
  } catch (_) {
    current = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  // Build a lookup of existing backends by id so we can preserve masked keys
  // and missing timeoutMs when the frontend sends back the status output
  // (status masks keys as '***' and omits timeoutMs).
  const existingById = {};
  for (const eb of (current.backends || [])) {
    if (eb && eb.id) existingById[eb.id] = eb;
  }

  let mergedBackends = Array.isArray(input.backends) ? input.backends : (current.backends || []);
  if (Array.isArray(input.backends)) {
    mergedBackends = input.backends.map(function (b) {
      if (!b || typeof b !== 'object') return b;
      const eb = existingById[b.id];
      if (!eb) return b;
      const out = Object.assign({}, b);
      // Preserve key when the incoming value is a mask placeholder
      if (typeof out.key === 'string' && (/^\*+$/.test(out.key) || /^•+$/.test(out.key))) {
        out.key = eb.key;
      }
      // Preserve timeoutMs when missing or invalid (status does not return it)
      if (typeof out.timeoutMs !== 'number' || out.timeoutMs < 500 || out.timeoutMs > 60000) {
        out.timeoutMs = eb.timeoutMs || 8000;
      }
      return out;
    });
  }

  const merged = {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : (current.enabled !== false),
    backends: mergedBackends,
    qualityMap: (input.qualityMap && typeof input.qualityMap === 'object' && !Array.isArray(input.qualityMap))
      ? input.qualityMap
      : (current.qualityMap || {}),
    selectedBackend: (typeof input.selectedBackend === 'string' && input.selectedBackend.trim())
      ? input.selectedBackend.trim()
      : (current.selectedBackend || null),
  };

  // Validate backends
  if (!Array.isArray(merged.backends) || merged.backends.length === 0) {
    const err = new Error('INVALID_LX_CONFIG: backends must be a non-empty array');
    err.code = 'INVALID_LX_CONFIG';
    throw err;
  }

  const VALID_QUALITYS = new Set(QUALITY_ORDER);
  const VALID_STYLES = new Set(['query', 'path', 'chksz', 'xinghai']);

  for (let i = 0; i < merged.backends.length; i++) {
    const b = merged.backends[i];
    if (!b || typeof b !== 'object') {
      const err = new Error('INVALID_LX_CONFIG: backend[' + i + '] must be an object');
      err.code = 'INVALID_LX_CONFIG';
      throw err;
    }
    if (typeof b.id !== 'string' || !b.id.trim()) {
      const err = new Error('INVALID_LX_CONFIG: backend[' + i + '].id must be a non-empty string');
      err.code = 'INVALID_LX_CONFIG';
      throw err;
    }
    if (typeof b.name !== 'string' || !b.name.trim()) {
      const err = new Error('INVALID_LX_CONFIG: backend[' + i + '].name must be a non-empty string');
      err.code = 'INVALID_LX_CONFIG';
      throw err;
    }
    if (typeof b.baseUrl !== 'string' || !/^https?:\/\//i.test(b.baseUrl)) {
      const err = new Error('INVALID_LX_CONFIG: backend[' + i + '].baseUrl must be an http/https URL');
      err.code = 'INVALID_LX_CONFIG';
      throw err;
    }
    if (!VALID_STYLES.has(b.style)) {
      const err = new Error('INVALID_LX_CONFIG: backend[' + i + '].style must be "query" or "path"');
      err.code = 'INVALID_LX_CONFIG';
      throw err;
    }
    if (typeof b.keyHeader !== 'string') {
      const err = new Error('INVALID_LX_CONFIG: backend[' + i + '].keyHeader must be a string');
      err.code = 'INVALID_LX_CONFIG';
      throw err;
    }
    if (typeof b.key !== 'string') {
      const err = new Error('INVALID_LX_CONFIG: backend[' + i + '].key must be a string');
      err.code = 'INVALID_LX_CONFIG';
      throw err;
    }
    if (typeof b.timeoutMs !== 'number' || b.timeoutMs < 500 || b.timeoutMs > 60000) {
      const err = new Error('INVALID_LX_CONFIG: backend[' + i + '].timeoutMs must be a number 500-60000');
      err.code = 'INVALID_LX_CONFIG';
      throw err;
    }
    if (!Array.isArray(b.qualitys) || b.qualitys.length === 0) {
      const err = new Error('INVALID_LX_CONFIG: backend[' + i + '].qualitys must be a non-empty array');
      err.code = 'INVALID_LX_CONFIG';
      throw err;
    }
    for (const q of b.qualitys) {
      if (!VALID_QUALITYS.has(q)) {
        const err = new Error('INVALID_LX_CONFIG: backend[' + i + '].qualitys contains invalid quality "' + q + '"');
        err.code = 'INVALID_LX_CONFIG';
        throw err;
      }
    }
  }

  // Validate qualityMap keys
  for (const k of Object.keys(merged.qualityMap)) {
    if (!VALID_QUALITYS.has(merged.qualityMap[k])) {
      const err = new Error('INVALID_LX_CONFIG: qualityMap.' + k + ' must map to a valid quality');
      err.code = 'INVALID_LX_CONFIG';
      throw err;
    }
  }

  // Atomic write: tmp file + rename (mirrors server.js:203-213)
  const dir = path.dirname(CONFIG_FILE);
  const tempFile = CONFIG_FILE + '.tmp-' + process.pid;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {
    // directory may already exist — ignore EEXIST
  }
  fs.writeFileSync(tempFile, JSON.stringify(merged, null, 2), 'utf8');
  fs.renameSync(tempFile, CONFIG_FILE);

  // Invalidate config cache so next read picks up the new file
  _configCache = null;
  _configMtime = 0;

  return merged;
}

// ---------- Cache ----------

function _cacheKey(source, songId, quality, backendId) {
  return String(source) + ':' + String(songId) + ':' + String(quality) + ':' + String(backendId);
}

function _cacheGet(key) {
  const entry = urlCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    urlCache.delete(key);
    return null;
  }
  return entry.result;
}

function _cacheSet(key, result, ttlMs) {
  if (urlCache.size >= CACHE_MAX) {
    const firstKey = urlCache.keys().next().value;
    if (firstKey !== undefined) urlCache.delete(firstKey);
  }
  urlCache.set(key, { result: result, expiresAt: Date.now() + ttlMs });
}

// ---------- Throttle ----------

function _checkThrottle(backendId) {
  let state = backendThrottle.get(backendId);
  const now = Date.now();
  if (!state) {
    state = { lastRequestAt: 0, minuteRequests: [] };
    backendThrottle.set(backendId, state);
  }
  // Purge entries older than 60 seconds
  state.minuteRequests = state.minuteRequests.filter(function (t) { return now - t < 60000; });
  if (now - state.lastRequestAt < THROTTLE_MIN_GAP_MS) {
    return { throttled: true, reason: 'min_gap' };
  }
  if (state.minuteRequests.length >= THROTTLE_MAX_PER_MIN) {
    return { throttled: true, reason: 'rate_limit' };
  }
  return { throttled: false };
}

function _recordThrottle(backendId) {
  let state = backendThrottle.get(backendId);
  if (!state) {
    state = { lastRequestAt: 0, minuteRequests: [] };
    backendThrottle.set(backendId, state);
  }
  const now = Date.now();
  state.lastRequestAt = now;
  state.minuteRequests.push(now);
  state.minuteRequests = state.minuteRequests.filter(function (t) { return now - t < 60000; });
}

// ---------- Quality Mapping ----------

/**
 * Map a Mineradio quality key (standard/exhigh/lossless/hires/jymaster)
 * through the qualityMap to a backend-quality string, then clamp to the
 * backend's declared qualitys by picking the highest declared quality
 * that is <= the requested one in canonical order.
 * If no declared quality is <= requested, use the lowest declared.
 */
function _mapQuality(qualityKey, qualityMap, backendQualitys) {
  const mapped = (qualityMap && qualityMap[qualityKey])
    || (qualityMap && qualityMap['hires'])
    || '128k';

  const mappedIdx = QUALITY_ORDER.indexOf(mapped);
  if (mappedIdx < 0) {
    // Fallback: find lowest declared
    const sorted = backendQualitys
      .filter(function (q) { return QUALITY_ORDER.indexOf(q) >= 0; })
      .sort(function (a, b) { return QUALITY_ORDER.indexOf(a) - QUALITY_ORDER.indexOf(b); });
    return sorted[0] || '128k';
  }

  // Pick the highest declared quality <= mapped
  const candidates = backendQualitys
    .filter(function (q) {
      var idx = QUALITY_ORDER.indexOf(q);
      return idx >= 0 && idx <= mappedIdx;
    })
    .sort(function (a, b) { return QUALITY_ORDER.indexOf(b) - QUALITY_ORDER.indexOf(a); });

  if (candidates.length > 0) return candidates[0];

  // None <= mapped, use the lowest declared quality
  const sorted = backendQualitys
    .filter(function (q) { return QUALITY_ORDER.indexOf(q) >= 0; })
    .sort(function (a, b) { return QUALITY_ORDER.indexOf(a) - QUALITY_ORDER.indexOf(b); });
  return sorted[0] || '128k';
}

// ---------- Tag Signature (flower/野花 anti-leech) ----------

/**
 * Generate the `tag` header required by the flower backend.
 * Algorithm: hex( JSON.stringify( path.match(/(?:\d\w)+/g), null, 1 ) )
 * where path is the URL path WITHOUT the host portion.
 *
 * Example: path="/flower/v1/url/kg/ABCDEF01/128k"
 *   → matches ["ABCDEF01","128k"]
 *   → JSON.stringify with null,1
 *   → hex-encode
 */
function _generateFlowerTag(urlPath) {
  var matches = urlPath.match(/(?:\d\w)+/g);
  var jsonStr = JSON.stringify(matches, null, 1);
  // hex-encode: each byte → two hex chars
  var hex = '';
  for (var i = 0; i < jsonStr.length; i++) {
    var code = jsonStr.charCodeAt(i);
    hex += ('0' + code.toString(16)).slice(-2);
  }
  return hex;
}

// ---------- URL Building ----------

function _buildBackendUrl(backend, source, songId, quality, extraParams) {
  var base = String(backend.baseUrl).replace(/\/+$/, '');
  if (backend.style === 'chksz') {
    // ChKSz API: /api/163_music?id={songId}&level={quality}
    var chkszQuality = quality;
    if (quality === '128k' || quality === '320k') chkszQuality = '320k';
    else if (quality === 'flac' || quality === 'flac24bit') chkszQuality = 'hires';
    return base + '/api/163_music?id=' + encodeURIComponent(songId) + '&level=' + encodeURIComponent(chkszQuality);
  }
  if (backend.style === 'xinghai') {
    // 星海后端 API: /lx/api/?source=qq&name=晴天&singer=周杰伦&songmid=0039MnYb0qxYhV&quality=320k
    // 实测星海支持 qq/kg/kw/migu/kuwo/netease 源；网易云必须用 source=netease（不是 wy）
    var x = extraParams || {};
    // Map lx source to xinghai source: tx->qq, wy->netease, kg->kg, kw->kw, mg->migu
    var xSource = source;
    if (source === 'tx') xSource = 'qq';
    else if (source === 'wy') xSource = 'netease';
    else if (source === 'mg') xSource = 'migu';
    var url = base + '/lx/api/?source=' + encodeURIComponent(xSource);
    url += '&name=' + encodeURIComponent(x.name || '');
    url += '&singer=' + encodeURIComponent(x.artist || '');
    // Use songmid if available, otherwise fallback to songId
    var xSongmid = x.songmid || x.mid || x.hash || songId;
    url += '&songmid=' + encodeURIComponent(xSongmid);
    url += '&quality=' + encodeURIComponent(quality);
    if (x.duration) url += '&interval=' + encodeURIComponent(x.duration);
    return url;
  }
  if (backend.style === 'path') {
    return base + '/url/' + encodeURIComponent(source) + '/' + encodeURIComponent(songId) + '/' + encodeURIComponent(quality);
  }
  // Default: query style
  return base + '/url?source=' + encodeURIComponent(source) + '&songId=' + encodeURIComponent(songId) + '&quality=' + encodeURIComponent(quality);
}

/**
 * Extract the path portion from a full URL (everything after host).
 * "http://97.64.37.235/flower/v1/url/kg/ABC/128k" → "/flower/v1/url/kg/ABC/128k"
 */
function _extractPath(url) {
  var idx = url.indexOf('/', url.indexOf('//') + 2);
  return idx >= 0 ? url.substring(idx) : '/';
}

// ---------- URL Validation ----------

/**
 * Validate a resolved URL. Returns false when the URL is empty, not http/https,
 * longer than 2048 chars, or the response message indicates a failure
 * (e.g. "无法获取播放链接" placeholder).
 */
function _validateUrl(url, msg) {
  if (typeof url !== 'string' || url.length === 0) return false;
  if (url.length > 2048) return false;
  if (!/^https?:\/\//i.test(url)) return false;

  var msgStr = String(msg || '');
  if (/无法获取播放链接|获取失败|获取音乐|failed|error/i.test(msgStr)) return false;

  return true;
}

/**
 * 轻量级试听URL检测 —— 只检查URL路径模式，不发网络请求。
 * 返回 { ok: true } 或 { ok: false, reason: 'xxx' }。
 */
function _isTrialUrl(url) {
  if (typeof url !== 'string') return { ok: true };

  // 网易云试听CDN路径标识
  if (/jd-musicrep-ts/.test(url)) return { ok: false, reason: 'netease_trial_jd-musicrep-ts' };
  if (/m\d+\.music\.126\.net\/\d+\/[a-f0-9]{32}\/jd-musicrep/.test(url)) return { ok: false, reason: 'netease_trial_jd-musicrep' };

  return { ok: true };
}

// ---------- Resolve ----------

/**
 * Resolve a playable URL from configured LX Music backends.
 *
 * @param {Object} params - { source, songId, quality }
 * @param {Object} [opts] - { bypassCache: boolean }
 * @returns {Promise<Object>} - { provider, source, playable, ... }
 */
async function resolveLxMusicUrl(params, opts) {
  var source = String(params && params.source || '');
  var songId = String(params && params.songId || '');
  var qualityKey = String(params && params.quality || 'hires');
  var bypassCache = !!(opts && opts.bypassCache);
  var preferredBackend = String(params && params.backend || '');
  // Extra params for backends that need them (e.g. xinghai)
  var extraParams = {
    name: String(params && params.name || ''),
    artist: String(params && params.artist || ''),
    songmid: String(params && params.songmid || ''),
    hash: String(params && params.hash || ''),
    mid: String(params && params.mid || ''),
    mixSongId: String(params && params.mixSongId || ''),
    provider: String(params && params.provider || ''),
    duration: Number(params && params.duration) || 0,
  };

  if (!source || !songId) {
    return { provider: 'lxmusic', playable: false, reason: 'invalid_params' };
  }

  var config = getLxMusicConfig();
  var backends = (config.backends || []).filter(function (b) { return b && b.enabled !== false; });

  if (backends.length === 0) {
    return { provider: 'lxmusic', playable: false, reason: 'no_backends_enabled' };
  }

  // If a specific backend is preferred, move it to the front of the list
  if (preferredBackend) {
    var idx = backends.findIndex(function (b) { return b.id === preferredBackend; });
    if (idx > 0) {
      var preferred = backends.splice(idx, 1)[0];
      backends.unshift(preferred);
    }
  }

  var qualityMap = config.qualityMap || {};
  var errors = [];

  // Build quality fallback list: try requested quality first, then 128k if different
  var qualitiesToTry = [qualityKey];
  if (qualityKey !== '128k') qualitiesToTry.push('128k');
  console.log('[LxMusicResolve] qualities to try: ' + qualitiesToTry.join(', '));

  for (var qi = 0; qi < qualitiesToTry.length; qi++) {
    var tryQualityKey = qualitiesToTry[qi];

  for (var i = 0; i < backends.length; i++) {
    var backend = backends[i];
    var backendId = backend.id;
    var key = _cacheKey(source, songId, tryQualityKey, backendId);

    // --- Cache lookup (unless bypassed) ---
    if (!bypassCache) {
      var cached = _cacheGet(key);
      if (cached) {
        if (cached.playable === false) {
          errors.push({ backend: backendId, error: 'cached_negative', code: 'CACHED_NEGATIVE' });
          continue;
        }
        cached.cacheHit = true;
        return cached;
      }
    }

    // --- Throttle check ---
    var throttle = _checkThrottle(backendId);
    if (throttle.throttled && !(opts && opts.bypassCooldown)) {
      errors.push({ backend: backendId, error: 'throttled:' + throttle.reason, code: 'THROTTLED' });
      continue;
    }

    // --- Quality mapping & clamping ---
    var finalQuality = _mapQuality(tryQualityKey, qualityMap, backend.qualitys || ['128k']);

    // --- Build request ---
    var requestUrl = _buildBackendUrl(backend, source, songId, finalQuality, extraParams);
    var headers = { 'User-Agent': LX_UA };
    if (backend.keyHeader && typeof backend.key === 'string') {
      headers[backend.keyHeader] = backend.key;
    }
    // flower/野花 requires tag signature header (anti-leech)
    if (backend.id === 'yehua') {
      var urlPath = _extractPath(requestUrl);
      headers['ver'] = '2.0.0';
      headers['source-ver'] = '1';
      headers['tag'] = _generateFlowerTag(urlPath);
      if (_debugLog) _debugLog('RESOLVE', '野花 tag 签名', { path: urlPath, tag: headers['tag'].substring(0, 20) + '...' });
    }
    if (_debugLog) _debugLog('RESOLVE', '请求后端', { backendId, requestUrl, finalQuality, tryQualityKey });

    var timeoutMs = Number(backend.timeoutMs) || 8000;
    var controller;
    var timer;
    try {
      controller = new AbortController();
      timer = setTimeout(function () { controller.abort(); }, timeoutMs);
    } catch (_) {
      // AbortController not available (shouldn't happen in Node 22+)
      errors.push({ backend: backendId, error: 'abort_controller_unavailable', code: 'INTERNAL' });
      continue;
    }

    try {
      var response = await _electronFetch(requestUrl, { headers: headers, timeout: timeoutMs, signal: controller.signal });
    } catch (fetchErr) {
      clearTimeout(timer);
      var isTimeout = fetchErr && fetchErr.name === 'AbortError';
      errors.push({
        backend: backendId,
        error: isTimeout ? 'timeout' : ('network:' + fetchErr.message),
        code: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
      });
      _cacheSet(key, { playable: false }, CACHE_NEGATIVE_TTL);
      _updateBackendStatus(backendId, false, isTimeout ? 'timeout' : fetchErr.message);
      continue;
    } finally {
      clearTimeout(timer);
    }

    _recordThrottle(backendId);

    // --- HTTP status check ---
    if (!response.ok) {
      errors.push({ backend: backendId, error: 'HTTP ' + response.status, code: response.status });
      _cacheSet(key, { playable: false }, CACHE_NEGATIVE_TTL);
      _updateBackendStatus(backendId, false, 'HTTP ' + response.status);
      continue;
    }

    // --- Parse JSON ---
    var body;
    try {
      body = await response.json();
    } catch (parseErr) {
      errors.push({ backend: backendId, error: 'parse:' + parseErr.message, code: 'PARSE_ERROR' });
      _cacheSet(key, { playable: false }, CACHE_NEGATIVE_TTL);
      _updateBackendStatus(backendId, false, 'parse error: ' + parseErr.message);
      continue;
    }

    // --- Check body.code ---
    var code = body && body.code;
    // Codes that indicate backend rejection/rate-limiting
    if (code === 1 || code === 403 || code === 5 || code === 429) {
      errors.push({ backend: backendId, error: 'code:' + code, code: code });
      _cacheSet(key, { playable: false }, CACHE_NEGATIVE_TTL);
      _updateBackendStatus(backendId, false, 'code:' + code);
      continue;
    }

    // --- Log raw response for debugging ---
    console.log('[LxMusicResolve] backend=' + backendId + ' response code=' + code + ' body=' + JSON.stringify(body).substring(0, 300));

    // --- Extract URL ---
    var resolvedUrl = null;
    if (code === 200) {
      // ikun v22: body.url; ikun v515: body.data (if it's a string)
      // ChKSz: body.data.url (nested object)
      resolvedUrl = body.url;
      if (!resolvedUrl && typeof body.data === 'string') {
        resolvedUrl = body.data;
      }
      // ChKSz format: {code:200, data:{url:"..."}}
      if (!resolvedUrl && body.data && typeof body.data === 'object' && typeof body.data.url === 'string') {
        resolvedUrl = body.data.url;
      }
    } else if (code === 0) {
      // flower/野花 uses body.data; huibq uses body.url
      // Check both defensively
      if (typeof body.data === 'string' && body.data.length > 0) {
        resolvedUrl = body.data;
      } else if (typeof body.url === 'string' && body.url.length > 0) {
        resolvedUrl = body.url;
      }
      // ChKSz format: {code:0, data:{url:"..."}}
      if (!resolvedUrl && body.data && typeof body.data === 'object' && typeof body.data.url === 'string') {
        resolvedUrl = body.data.url;
      }
    } else {
      // Unknown code — treat as failure
      errors.push({ backend: backendId, error: 'unknown_code:' + code, code: code });
      _cacheSet(key, { playable: false }, CACHE_NEGATIVE_TTL);
      _updateBackendStatus(backendId, false, 'unknown_code:' + code);
      continue;
    }

    // --- Validate URL ---
    var msg = (body && body.msg) || (body && body.message) || '';
    if (!_validateUrl(resolvedUrl, msg)) {
      errors.push({ backend: backendId, error: 'url_validation_failed', code: 'INVALID_URL' });
      _cacheSet(key, { playable: false }, CACHE_NEGATIVE_TTL);
      _updateBackendStatus(backendId, false, 'url validation failed');
      continue;
    }

    // --- 轻量级试听URL检测 ---
    var trialCheck = _isTrialUrl(resolvedUrl);
    if (!trialCheck.ok) {
      if (_debugLog) _debugLog('RESOLVE', '试听URL被拒绝', { backendId, reason: trialCheck.reason, url: resolvedUrl.substring(0, 120) });
      errors.push({ backend: backendId, error: 'trial_url:' + trialCheck.reason, code: 'TRIAL_URL' });
      _cacheSet(key, { playable: false }, CACHE_NEGATIVE_TTL);
      _updateBackendStatus(backendId, false, 'trial url: ' + trialCheck.reason);
      continue;
    }

    // --- Success ---
    var result = {
      provider: 'lxmusic',
      source: 'lxmusic',
      url: resolvedUrl,
      playable: true,
      level: tryQualityKey,
      quality: finalQuality,
      backend: backendId,
      cacheHit: false,
    };
    console.log('[LxMusicResolve] SUCCESS backend=' + backendId + ' quality=' + tryQualityKey + ' finalQuality=' + finalQuality);
    console.log('[LxMusicResolve] FULL_URL=' + resolvedUrl);
    console.log('[LxMusicResolve] URL_LENGTH=' + resolvedUrl.length);
    _cacheSet(key, result, CACHE_POSITIVE_TTL);
    _updateBackendStatus(backendId, true);
    return result;
  }
  } // end quality fallback loop

  // --- All backends failed ---
  return {
    provider: 'lxmusic',
    playable: false,
    reason: 'all_backends_failed',
    errors: errors,
  };
}

// ---------- Backend Status Tracking ----------

function _updateBackendStatus(backendId, reachable, lastError) {
  var entry = backendStatus.get(backendId);
  if (!entry) {
    entry = { reachable: null, lastError: null };
    backendStatus.set(backendId, entry);
  }
  entry.reachable = reachable;
  entry.lastError = lastError || null;
}

// ---------- Status ----------

function getLxMusicStatus() {
  var config;
  try {
    config = getLxMusicConfig();
  } catch (_) {
    config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  var backends = (config.backends || []).map(function (b) {
    var bs = backendStatus.get(b.id);
    return {
      id: b.id,
      name: b.name,
      baseUrl: b.baseUrl,
      style: b.style,
      keyHeader: b.keyHeader,
      key: '***',
      qualitys: (b.qualitys || []).slice(),
      lastError: bs ? bs.lastError : null,
      reachable: bs ? bs.reachable : null,
    };
  });

  var backendsUp = backends.filter(function (b) { return b.reachable === true; }).length;

  return {
    enabled: config.enabled !== false,
    backends: backends,
    backendsUp: backendsUp,
    selectedBackend: config.selectedBackend || null,
    qualityMap: config.qualityMap || {},
  };
}

// ---------- Exports ----------

module.exports = {
  getLxMusicConfig: getLxMusicConfig,
  saveLxMusicConfig: saveLxMusicConfig,
  resolveLxMusicUrl: resolveLxMusicUrl,
  getLxMusicStatus: getLxMusicStatus,
  updateBackendStatus: _updateBackendStatus,
  _test: {
    validateUrl: _validateUrl,
    mapQuality: _mapQuality,
    buildBackendUrl: _buildBackendUrl,
  },
};
