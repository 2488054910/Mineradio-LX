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
      id: 'gdstudio',
      name: 'GD Studio 音源',
      baseUrl: 'https://music-api.gdstudio.xyz/api.php',
      style: 'gdstudio',
      keyHeader: '',
      key: '',
      timeoutMs: 10000,
      qualitys: ['128k', '320k', 'flac', 'flac24bit'],
    },
    {
      id: 'chksz',
      name: 'ChKSz 音源',
      baseUrl: 'https://api.chksz.com',
      style: 'chksz',
      keyHeader: '',
      key: '',
      timeoutMs: 10000,
      qualitys: ['128k', '320k', 'flac', 'flac24bit'],
    },
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
  const VALID_STYLES = new Set(['query', 'path', 'chksz', 'xinghai', 'gdstudio']);

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
  // Raw backend-quality keys (e.g. the '128k' fallback pass) map to themselves;
  // routing them through qualityMap used to turn '128k' into 'flac24bit'
  // because qualityMap has no '128k' key and fell back to qualityMap['hires'].
  const mapped = QUALITY_ORDER.indexOf(qualityKey) >= 0
    ? qualityKey
    : (qualityMap && qualityMap[qualityKey])
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
    // ChKSz API (moved to api.chksz.com in 2026, api.chksz.top is retired):
    // per-platform endpoints, apikey query auth, netease-style level names.
    //   netease: /api/163_music   qq: /api/qq_music   kugou: /api/kugou_music
    var chkszEndpoints = { wy: '/api/163_music', tx: '/api/qq_music', kg: '/api/kugou_music' };
    var chkszEndpoint = chkszEndpoints[source] || '/api/163_music';
    var chkszLevels = { '128k': 'standard', '320k': 'exhigh', 'flac': 'lossless', 'flac24bit': 'hires' };
    var chkszLevel = chkszLevels[quality] || 'lossless';
    var chkszUrl = base + chkszEndpoint + '?id=' + encodeURIComponent(songId) + '&level=' + encodeURIComponent(chkszLevel);
    if (backend.key) chkszUrl += '&apikey=' + encodeURIComponent(backend.key);
    return chkszUrl;
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
  if (backend.style === 'gdstudio') {
    // GD Studio API（洛雪生态最活跃公共后端）:
    //   url:  {baseUrl}?types=url&source={netease|joox|bilibili}&id={id}&br={128|192|320|740|999}
    //   search: {baseUrl}?types=search&source={source}&name={name}&count={n}
    // 网易云 VIP 歌曲 netease 源返回空 URL；周杰伦等 VIP 曲目走 joox（QQ 海外版）可播
    var g = extraParams || {};
    var gSource = source;
    // Map lx source to gdstudio source: wy->netease, tx->joox（大陆 tencent 源已下架）, kg->kuwo(不稳定), kw->kuwo
    if (source === 'wy') gSource = 'netease';
    else if (source === 'tx') gSource = 'joox';
    else if (source === 'kg' || source === 'kw') gSource = 'kuwo';
    else if (source === 'mg') gSource = 'migu';
    // Map quality to br: 128k->128, 320k->320, flac->740, flac24bit->999
    var brMap = { '128k': 128, '320k': 320, 'flac': 740, 'flac24bit': 999 };
    var br = brMap[quality] || 320;
    var gId = g.songmid || g.mid || g.hash || g.url_id || songId;
    return base + '?types=url&source=' + encodeURIComponent(gSource) + '&id=' + encodeURIComponent(gId) + '&br=' + br;
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
 * longer than 2048 chars, or looks like an error placeholder itself.
 *
 * Note: a failure-style `msg` ("无法获取播放链接！") does NOT invalidate a
 * non-empty URL — some backends (e.g. huibq) return a real playable URL
 * alongside boilerplate failure text, and the URL is authoritative.
 */
function _validateUrl(url, msg) {
  if (typeof url !== 'string' || url.length === 0) return false;
  if (url.length > 2048) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  // Placeholder bodies where the error text ended up inside the url field
  if (/无法获取播放链接|获取失败/.test(url)) return false;

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
    // GD Studio API 无 code 字段，直接返回 {url, br, size}；视为成功
    var gdstudioDirect = (code === undefined && body && typeof body.url === 'string');
    // Codes that indicate backend rejection/rate-limiting/auth-gating
    if (!gdstudioDirect && (code === 1 || code === 401 || code === 403 || code === 500 || code === 5 || code === 429)) {
      errors.push({ backend: backendId, error: 'code:' + code, code: code });
      _cacheSet(key, { playable: false }, CACHE_NEGATIVE_TTL);
      _updateBackendStatus(backendId, false, 'code:' + code);
      continue;
    }

    // --- Log raw response for debugging ---
    console.log('[LxMusicResolve] backend=' + backendId + ' response code=' + code + ' body=' + JSON.stringify(body).substring(0, 300));

    // --- Extract URL ---
    var resolvedUrl = null;
    if (gdstudioDirect) {
      // GD Studio: {url, br, size} 无 code 字段
      resolvedUrl = body.url;
    } else if (code === 200) {
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
      // --- GD Studio search+resolve fallback ---
      // When gdstudio returns empty URL (e.g. QQ songmid on joox source doesn't match),
      // search for the song by name+artist and resolve with the correct gdstudio ID.
      if (backend.style === 'gdstudio' && extraParams && extraParams.name) {
        try {
          var fallbackResult = await _gdstudioSearchAndResolve(backend, source, finalQuality, extraParams, timeoutMs);
          if (fallbackResult && fallbackResult.url) {
            var fallbackCheck = _isTrialUrl(fallbackResult.url);
            if (fallbackCheck.ok) {
              var fbResult = {
                provider: 'lxmusic',
                source: 'lxmusic',
                url: fallbackResult.url,
                playable: true,
                level: tryQualityKey,
                quality: finalQuality,
                backend: backendId + '+search',
                cacheHit: false,
              };
              console.log('[LxMusicResolve] gdstudio search+resolve fallback SUCCESS backend=' + backendId);
              _cacheSet(key, fbResult, CACHE_POSITIVE_TTL);
              _updateBackendStatus(backendId, true);
              return fbResult;
            }
          }
        } catch (fbErr) {
          console.log('[LxMusicResolve] gdstudio search fallback failed: ' + fbErr.message);
        }
      }
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

  // --- All backends failed: cross-source rescue before giving up ---
  // Searches kuwo/joox via gdstudio for the same song (strict name+artist
  // match) and resolves the found ID through any backend supporting it.
  if (!opts || !opts._noRescue) {
    try {
      var rescued = await _crossSourceRescue(source, qualityKey, extraParams, config);
      if (rescued && rescued.playable) {
        if (_debugLog) _debugLog('RESOLVE', '跨源救援成功', { from: source, backend: rescued.backend, quality: rescued.quality });
        return rescued;
      }
    } catch (rescueErr) {
      if (_debugLog) _debugLog('RESOLVE', '跨源救援异常', { error: rescueErr && rescueErr.message });
    }
  }

  // --- All backends failed ---
  return {
    provider: 'lxmusic',
    playable: false,
    reason: 'all_backends_failed',
    errors: errors,
  };
}

// ---------- Text Normalization (traditional→simplified for matching) ----------

// Compact traditional→simplified pairs for characters that commonly appear in
// artist/song names coming from joox/kuwo search results (周杰倫→周杰伦 etc).
var T2S_MAP = (function () {
  var pairs = '倫伦 樂乐 葉叶 灣湾 愛爱 聲声 鳳凤 蘭兰 麗丽 儀仪 寶宝 頭头 發发 龍龙 鳥鸟 語语 聽听 寫写 車车 馬马 東东 爾尔 內内 萬万 與与 義义 齊齐 喬乔 傑杰 瑪玛 莉莉 娜娜 絲丝 貝贝 維维 納纳 亞亚 軍军 飛飞 雲云 張张 開开 關关 門门 長长 風风 電电 話话 國国 學学 會会 體体 動动 場场 區区 歷历 歸归 帶带 圖图 團团 燈灯 無无 為为 經经 濟济 運运 記记 認认 識识 辦办 蘇苏 鐵铁 銀银 錢钱 陳陈 孫孙 許许 劉刘 黃黄 楊杨 吳吴 趙赵 声声 绵綿 綵彩 螢萤 憂优 憂忧 樂乐 溫温 滿满 激激 戲戏 護护 衛卫 荣荣 爺爷 嬌娇 緣缘 紅红 网網 络絡 联联 誉誉 缘缘 红红 浪浪 漫漫';
  var map = {};
  var arr = pairs.split(/\s+/);
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].length === 2) map[arr[i][0]] = arr[i][1];
  }
  return map;
})();

/**
 * Normalize a name/artist string for fuzzy matching: lowercase, strip spaces
 * and punctuation, and fold traditional Chinese variants to simplified so
 * "周杰倫" matches "周杰伦". Only used for comparison — never for display.
 */
function _normText(s) {
  var str = String(s || '').toLowerCase();
  var out = '';
  for (var i = 0; i < str.length; i++) {
    var ch = str[i];
    if (T2S_MAP[ch] !== undefined) { out += T2S_MAP[ch]; continue; }
    if (/[\s\-'’·•.,，。()（）\/\\|:：!！?？&]/.test(ch)) continue;
    out += ch;
  }
  return out;
}

/** True when the two artist strings overlap after normalization. */
function _artistMatches(targetArtist, itemArtist) {
  var a = _normText(targetArtist);
  var b = _normText(itemArtist);
  if (!a || !b) return false;
  if (a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return true;
  // token overlap: any normalized token of one appears in the other
  var at = a.split(/[\s,，、&]+/);
  for (var i = 0; i < at.length; i++) {
    if (at[i] && b.indexOf(at[i]) >= 0) return true;
  }
  return false;
}

// ---------- GD Studio Search + Resolve Fallback ----------

/**
 * Map an lx source key to the gdstudio search/url source names that actually
 * work today (verified 2026-09): gdstudio rejects tencent/kugou/migu and its
 * joox source has its own ID space, so the search+resolve fallback below is
 * what makes tx/wy songs resolvable there.
 */
function _gdstudioSearchSources(source) {
  if (source === 'wy') return ['netease'];
  if (source === 'tx') return ['joox'];
  if (source === 'kg' || source === 'kw') return ['kuwo'];
  if (source === 'mg') return ['kuwo'];
  return [String(source || 'netease')];
}

/**
 * Search gdstudio across `searchSources` for a song by name+artist and return
 * the first STRONG match: exact/normalized name equality AND artist overlap.
 * Mere name containment (covers, remixes, karaoke versions) is rejected so we
 * never play the wrong song. Returns { source, id } or null.
 */
async function _gdstudioSearch(backend, searchSources, extraParams, timeoutMs) {
  var base = String(backend.baseUrl).replace(/\/+$/, '');
  var name = extraParams && extraParams.name || '';
  var artist = extraParams && extraParams.artist || '';
  if (!name) return null;

  var targetName = _normText(name);
  var targetArtist = String(artist || '');

  for (var ssi = 0; ssi < searchSources.length; ssi++) {
    var searchSource = searchSources[ssi];
    var query = (name + ' ' + targetArtist).trim();
    var searchUrl = base + '?types=search&source=' + encodeURIComponent(searchSource) + '&name=' + encodeURIComponent(query) + '&count=8';
    if (_debugLog) _debugLog('RESOLVE', 'gdstudio 搜索', { source: searchSource, query });

    try {
      var searchResp = await _electronFetch(searchUrl, { timeout: timeoutMs || 8000 });
      if (!searchResp.ok) continue;
      var searchBody = await searchResp.json();
      if (!Array.isArray(searchBody)) continue;

      for (var si = 0; si < searchBody.length; si++) {
        var item = searchBody[si];
        var itemName = _normText(item && item.name);
        var itemArtist = Array.isArray(item && item.artist) ? item.artist.join(' ') : String((item && item.artist) || '');
        var nameHit = itemName && (itemName === targetName
          || (itemName.length > targetName ? itemName.indexOf(targetName) === 0 : targetName.indexOf(itemName) === 0));
        var artistHit = _artistMatches(targetArtist, itemArtist);
        // Strong match only: name must match exactly (after normalization) and
        // the artist must overlap when the result declares an artist.
        if (nameHit && itemArtist && artistHit) {
          var matched = { source: searchSource, id: String(item.url_id || item.id || ''), name: item.name };
          if (_debugLog) _debugLog('RESOLVE', 'gdstudio 搜索强匹配', matched);
          if (matched.id) return matched;
        }
      }
    } catch (e) {
      if (_debugLog) _debugLog('RESOLVE', 'gdstudio 搜索失败', { source: searchSource, error: e.message });
    }
  }
  return null;
}

/**
 * When a gdstudio direct URL resolve returns an empty URL (VIP song, or a QQ
 * songmid that does not exist in joox's ID space), search gdstudio for the
 * song by name+artist and resolve with the correct gdstudio ID.
 * Returns { url, quality } or null on failure.
 */
async function _gdstudioSearchAndResolve(backend, source, quality, extraParams, timeoutMs) {
  var base = String(backend.baseUrl).replace(/\/+$/, '');
  var searchSources = _gdstudioSearchSources(source);
  var best = await _gdstudioSearch(backend, searchSources, extraParams, timeoutMs);
  if (!best || !best.id) {
    if (_debugLog) _debugLog('RESOLVE', 'gdstudio 搜索无强匹配', { sources: searchSources });
    return null;
  }

  var brMap = { '128k': 128, '320k': 320, 'flac': 740, 'flac24bit': 999 };
  var br = brMap[quality] || 320;
  var resolveUrl = base + '?types=url&source=' + encodeURIComponent(best.source) + '&id=' + encodeURIComponent(best.id) + '&br=' + br;
  if (_debugLog) _debugLog('RESOLVE', 'gdstudio 二次解析', { url: resolveUrl });

  try {
    var resolveResp = await _electronFetch(resolveUrl, { timeout: timeoutMs || 8000 });
    if (!resolveResp.ok) return null;
    var resolveBody = await resolveResp.json();
    if (resolveBody && resolveBody.url && resolveBody.url.length > 0) {
      return { url: resolveBody.url, quality: quality };
    }
  } catch (e) {
    console.log('[LxMusicResolve] gdstudio search fallback error: ' + e.message);
  }
  return null;
}

// ---------- Cross-Source Rescue ----------

/**
 * Last-resort rescue when every backend failed for the song's own source:
 * search gdstudio on OTHER platforms (kuwo/joox) for the same song, then
 * resolve the found ID through any configured backend that supports that
 * platform (gdstudio itself, or xinghai whose kuwo source is verified working).
 *
 * Strict matching prevents playing a cover instead of the original.
 * Returns a playable result object or null.
 */
async function _crossSourceRescue(source, quality, extraParams, config) {
  var name = extraParams && extraParams.name || '';
  var artist = extraParams && extraParams.artist || '';
  if (!name || !artist) return null;

  var backends = (config.backends || []).filter(function (b) { return b && b.enabled !== false && b.style === 'gdstudio'; });
  if (backends.length === 0) return null;

  // Cross sources: kuwo first (has originals and xinghai can resolve it), then joox.
  var crossSources = ['kuwo', 'joox'];
  var ownSources = _gdstudioSearchSources(source);
  crossSources = crossSources.filter(function (s) { return ownSources.indexOf(s) < 0; });

  for (var bi = 0; bi < backends.length; bi++) {
    var backend = backends[bi];
    var timeoutMs = Number(backend.timeoutMs) || 8000;
    var match = await _gdstudioSearch(backend, crossSources, extraParams, timeoutMs);
    if (!match || !match.id) continue;

    if (_debugLog) _debugLog('RESOLVE', '跨源救援', { from: source, to: match.source, id: match.id, name: match.name });
    try {
      var result = await resolveLxMusicUrl({
        source: match.source,
        songId: match.id,
        quality: quality,
        name: name,
        artist: artist,
        songmid: match.id,
        provider: match.source,
        duration: extraParams.duration || 0,
      }, { bypassCache: true, bypassCooldown: true, _noRescue: true });
      if (result && result.playable) {
        result.rescuedFrom = source;
        return result;
      }
    } catch (e) {
      if (_debugLog) _debugLog('RESOLVE', '跨源救援解析失败', { error: e.message });
    }
  }
  return null;
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
