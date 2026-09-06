'use strict';

// ====================================================================
//  smoke-lxmusic.js — standalone Node smoke test for lxmusic-api.js
//  CommonJS, plain `node`, no framework, no npm deps.
//
//  Run:
//    node smoke-lxmusic.js                  (T1-T8 mocked, PASS => exit 0)
//    LX_SMOKE_FORCE_FAIL=1 node ...         (T4 fetch mocked to fail => exit 1)
//
//  Sections T1-T8 are fully mocked (deterministic, no network). The
//  LIVE section is best-effort: failures print LIVE_SKIPPED and never
//  affect the exit code.
//
//  Adapted to the REAL exported API of ../lxmusic-api.js:
//    - _test.validateUrl(url, msg) -> boolean   (msg is the 2nd arg)
//    - _test.mapQuality(qualityKey, qualityMap, backendQualitys)
//    - resolveLxMusicUrl({source,songId,quality}, {bypassCache})
//    - saveLxMusicConfig throws Error with .code === 'INVALID_LX_CONFIG'
//    - throttled backends are skipped with {code:'THROTTLED'} in errors,
//      or the request routes to the next backend (result.backend differs)
// ====================================================================

const m = require('../lxmusic-api.js');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'lxmusic-config.json');

const realFetch = global.fetch;
const forceFail = process.env.LX_SMOKE_FORCE_FAIL === '1';

let fetchCount = 0;
const results = [];

function record(name, pass, detail) {
  results.push({ name: name, pass: !!pass });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' -- ' + detail : ''));
}

function mockResponse(body, ok) {
  return {
    ok: ok === undefined ? true : ok,
    json: async function () { return body; },
  };
}

function installFetchMock(handler) {
  global.fetch = async function (url, init) {
    fetchCount += 1;
    return handler(url, init);
  };
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

(async function () {
  if (forceFail) {
    console.log('NOTE: LX_SMOKE_FORCE_FAIL=1 — T4 mock is poisoned and MUST fail.');
  }

  // ---------------------------------------------------------------- T1
  try {
    const status = m.getLxMusicStatus();
    const s = JSON.stringify(status);
    const pass = status.enabled === true
      && Array.isArray(status.backends) && status.backends.length >= 2
      && s.indexOf('share-v3') === -1
      && s.indexOf('public_source') === -1;
    record('T1 config loads + key masked', pass,
      pass ? '' : 'enabled=' + status.enabled + ' backends=' + (status.backends || []).length);
  } catch (e) {
    record('T1 config loads + key masked', false, String((e && e.message) || e));
  }

  // ---------------------------------------------------------------- T2
  try {
    // New contract: the URL itself is authoritative. A failure-style msg does
    // NOT invalidate a non-empty URL (huibq returns real URLs with boilerplate
    // failure msg); only empty/non-http URLs and error-text-in-url are invalid.
    const emptyRejected = m._test.validateUrl('', 'ok') === false;
    const nonHttpRejected = m._test.validateUrl('无法获取播放链接！', '') === false;
    const msgWithRealUrl = m._test.validateUrl(
      'http://panspace.kuwo.cn/f2afa55a304638d524fe825bf745704a/x/y.mp3',
      '无法获取播放链接！') === true;
    const cleanAccepted = m._test.validateUrl('https://example.com/a.mp3', 'ok') === true;
    const pass = emptyRejected && nonHttpRejected && msgWithRealUrl && cleanAccepted;
    record('T2 validateUrl URL-authoritative contract', pass,
      pass ? '' : JSON.stringify({ emptyRejected, nonHttpRejected, msgWithRealUrl, cleanAccepted }));
  } catch (e) {
    record('T2 validateUrl URL-authoritative contract', false, String((e && e.message) || e));
  }

  // ---------------------------------------------------------------- T3
  try {
    const qmap = m.getLxMusicConfig().qualityMap || {};
    const full = ['128k', '320k', 'flac', 'flac24bit'];
    const clamped = ['128k', '320k'];
    const standard = m._test.mapQuality('standard', qmap, full);
    const exhigh = m._test.mapQuality('exhigh', qmap, full);
    const hires = m._test.mapQuality('hires', qmap, full);
    const losslessClamped = m._test.mapQuality('lossless', qmap, clamped);
    // Regression: raw backend-quality keys must map to themselves, not to
    // qualityMap['hires'] (used to turn the '128k' fallback into flac24bit).
    const raw128 = m._test.mapQuality('128k', qmap, full);
    const pass = standard === '128k' && exhigh === '320k' && hires === 'flac24bit'
      && losslessClamped === '320k' && raw128 === '128k';
    record('T3 quality mapping + clamp + raw key', pass,
      pass ? '' : JSON.stringify({ standard: standard, exhigh: exhigh, hires: hires, losslessClamped: losslessClamped, raw128: raw128 }));
  } catch (e) {
    record('T3 quality mapping + clamp + raw key', false, String((e && e.message) || e));
  }

  // ---------------------------------------------------------------- T4
  try {
    installFetchMock(function (url) {
      if (forceFail) return mockResponse({ code: 1 });
      const s = String(url);
      if (s.indexOf('/url/') >= 0) {
        // path-style backend (huibq): {code:0, url}
        return mockResponse({ code: 0, url: 'https://example.com/y.mp3' });
      }
      // query-style backend (ikun): {code:200, url}
      return mockResponse({ code: 200, url: 'https://example.com/x.mp3' });
    });

    const params = { source: 'kg', songId: 'X', quality: 'exhigh' };
    const r1 = await m.resolveLxMusicUrl(params);
    // The module returns the same object reference it stores in the cache, so
    // the second call mutates it (cacheHit=true). Snapshot before calling again.
    const r1Snapshot = { playable: r1.playable, cacheHit: r1.cacheHit, url: r1.url, backend: r1.backend };
    const afterFirst = fetchCount;
    const r2 = await m.resolveLxMusicUrl(params);
    const afterSecond = fetchCount;

    const pass = r1Snapshot.playable === true && r1Snapshot.cacheHit === false
      && r1Snapshot.url === 'https://example.com/x.mp3'
      && r2.playable === true && r2.cacheHit === true
      && afterSecond === afterFirst;
    record('T4 mock happy path + cache', pass,
      pass ? '' : JSON.stringify({
        r1: r1Snapshot,
        r2: { playable: r2.playable, cacheHit: r2.cacheHit },
        fetches: afterFirst + ' -> ' + afterSecond,
      }));
  } catch (e) {
    record('T4 mock happy path + cache', false, String((e && e.message) || e));
  }

  // ---------------------------------------------------------------- T5
  try {
    installFetchMock(function () { throw new Error('mock network fail'); });
    const r = await m.resolveLxMusicUrl({ source: 'kg', songId: 'XFAIL', quality: 'exhigh' });
    const pass = r.playable === false && r.reason === 'all_backends_failed';
    record('T5 all backends fail', pass, pass ? '' : JSON.stringify(r));
  } catch (e) {
    record('T5 all backends fail', false, String((e && e.message) || e));
  }

  // ---------------------------------------------------------------- T6
  try {
    installFetchMock(function () { return mockResponse({ code: 1 }); });
    const params = { source: 'kg', songId: 'XNEG', quality: '128k' };
    const r1 = await m.resolveLxMusicUrl(params);
    const afterFirst = fetchCount;
    const r2 = await m.resolveLxMusicUrl(params);
    const afterSecond = fetchCount;
    const pass = r1.playable === false && r2.playable === false && afterSecond === afterFirst;
    record('T6 negative cache short-circuits refetch', pass,
      pass ? '' : JSON.stringify({ r1playable: r1.playable, r2playable: r2.playable, fetches: afterFirst + ' -> ' + afterSecond }));
  } catch (e) {
    record('T6 negative cache short-circuits refetch', false, String((e && e.message) || e));
  }

  // ---------------------------------------------------------------- T7
  try {
    installFetchMock(function (url) {
      const s = String(url);
      if (s.indexOf('/url/') >= 0) {
        return mockResponse({ code: 0, url: 'https://example.com/y.mp3' });
      }
      return mockResponse({ code: 200, url: 'https://example.com/x.mp3' });
    });

    const params = { source: 'kg', songId: 'XTHR', quality: '320k' };
    const a = await m.resolveLxMusicUrl(params, { bypassCache: true });
    const b = await m.resolveLxMusicUrl(params, { bypassCache: true });

    const routed = !!b.backend && b.backend !== a.backend;
    const throttledFlag = b.playable === false && Array.isArray(b.errors)
      && b.errors.some(function (e) { return e.code === 'THROTTLED'; });
    const pass = routed || throttledFlag;
    record('T7 throttle routes next backend or flags throttled', pass,
      pass ? 'observed=' + (routed ? 'routed ' + (a.backend || '-') + ' -> ' + (b.backend || '-') : 'throttled-flag in errors')
           : JSON.stringify({ a: { playable: a.playable, backend: a.backend }, b: { playable: b.playable, backend: b.backend, errors: b.errors } }));
  } catch (e) {
    record('T7 throttle routes next backend or flags throttled', false, String((e && e.message) || e));
  }

  // ---------------------------------------------------------------- T8
  try {
    const before = fs.readFileSync(CONFIG_FILE, 'utf8');

    let threwInvalid = false;
    try {
      m.saveLxMusicConfig({ backends: 'x' });
    } catch (e) {
      threwInvalid = e && e.code === 'INVALID_LX_CONFIG';
    }

    // Restore the exact config that was in effect before this test.
    const saved = m.saveLxMusicConfig(m.getLxMusicConfig());
    const after = fs.readFileSync(CONFIG_FILE, 'utf8');

    const pass = threwInvalid
      && !!saved && Array.isArray(saved.backends) && saved.backends.length >= 2
      && JSON.stringify(JSON.parse(before)) === JSON.stringify(JSON.parse(after));
    record('T8 save rejects invalid + restores config', pass,
      pass ? '' : JSON.stringify({ threwInvalid: threwInvalid, backends: saved && saved.backends.length, byteIdentical: before === after }));
  } catch (e) {
    record('T8 save rejects invalid + restores config', false, String((e && e.message) || e));
  }

  // ---------------------------------------------------------------- T9
  try {
    const chkszUrl = m._test.buildBackendUrl(
      { id: 'chksz', style: 'chksz', baseUrl: 'https://api.chksz.com', key: 'K1' },
      'tx', '0039MnYb0qxYhV', 'flac', {});
    const gdTxUrl = m._test.buildBackendUrl(
      { id: 'gdstudio', style: 'gdstudio', baseUrl: 'https://music-api.gdstudio.xyz/api.php' },
      'tx', '0039MnYb0qxYhV', 'flac', {});
    const gdKwUrl = m._test.buildBackendUrl(
      { id: 'gdstudio', style: 'gdstudio', baseUrl: 'https://music-api.gdstudio.xyz/api.php' },
      'kuwo', '228908', '128k', {});
    const pass = chkszUrl === 'https://api.chksz.com/api/qq_music?id=0039MnYb0qxYhV&level=lossless&apikey=K1'
      && gdTxUrl.indexOf('source=joox&id=0039MnYb0qxYhV&br=740') >= 0
      && gdKwUrl.indexOf('source=kuwo&id=228908&br=128') >= 0;
    record('T9 backend URL building (chksz per-source, gdstudio sources)', pass,
      pass ? '' : JSON.stringify({ chkszUrl, gdTxUrl, gdKwUrl }));
  } catch (e) {
    record('T9 backend URL building (chksz per-source, gdstudio sources)', false, String((e && e.message) || e));
  }

  // ---------------------------------------------------------------- T10
  try {
    // Cross-source rescue: every backend fails for wy/186016, gdstudio search
    // finds the song on kuwo, and xinghai resolves the kuwo id successfully.
    installFetchMock(function (url) {
      const s = String(url);
      if (s.indexOf('yy.zddyr.top') >= 0) {
        return mockResponse({ code: 200, url: 'http://car-er.kuwo.cn/mock/rescue.mp3' });
      }
      if (s.indexOf('types=search&source=kuwo') >= 0) {
        return mockResponse([{ id: '228908', name: '晴天', artist: ['周杰伦'], url_id: '228908' }]);
      }
      if (s.indexOf('types=search') >= 0) return mockResponse([]);
      if (s.indexOf('/url/') >= 0) return mockResponse({ code: 0, url: '' });
      return mockResponse({ url: '', br: 0, size: 0 }); // gdstudio empty resolve
    });

    const r = await m.resolveLxMusicUrl({
      source: 'wy', songId: '186016', quality: 'exhigh',
      name: '晴天', artist: '周杰伦', duration: 269000,
    }, { bypassCache: true });
    const pass = r.playable === true && r.backend === 'xinghai' && r.rescuedFrom === 'wy';
    record('T10 cross-source rescue (wy fail -> kuwo search -> xinghai)', pass,
      pass ? '' : JSON.stringify({ playable: r.playable, backend: r.backend, rescuedFrom: r.rescuedFrom, reason: r.reason, errors: r.errors }));
  } catch (e) {
    record('T10 cross-source rescue (wy fail -> kuwo search -> xinghai)', false, String((e && e.message) || e));
  }

  // ---------------------------------------------------------------- T11
  try {
    // nocache-style retry must bypass the 1.5s min-gap throttle so the second
    // attempt actually reaches the backend instead of failing with THROTTLED.
    installFetchMock(function () {
      return mockResponse({ code: 200, url: 'https://example.com/nocache.mp3' });
    });
    const params = { source: 'kg', songId: 'XNOCACHE', quality: '320k' };
    const a = await m.resolveLxMusicUrl(params, { bypassCache: true, bypassCooldown: true });
    const b = await m.resolveLxMusicUrl(params, { bypassCache: true, bypassCooldown: true });
    const bThrottled = b.errors && b.errors.some(function (e) { return e.code === 'THROTTLED'; });
    const pass = a.playable === true && b.playable === true && !bThrottled;
    record('T11 bypassCooldown retry reaches backend', pass,
      pass ? '' : JSON.stringify({ a: { playable: a.playable }, b: { playable: b.playable, throttled: bThrottled, errors: b.errors } }));
  } catch (e) {
    record('T11 bypassCooldown retry reaches backend', false, String((e && e.message) || e));
  }

  // ------------------------------------------------- LIVE (best-effort)
  // Restore the real fetch and let per-backend throttle windows elapse so
  // the live requests actually hit the network. Max 4 live requests total
  // (2 backends x 2 resolves). Failures never affect the exit code.
  global.fetch = realFetch;
  await sleep(1600);

  async function liveResolve(name, params) {
    try {
      const r = await m.resolveLxMusicUrl(params);
      console.log('LIVE ' + name + ': ' + JSON.stringify(r));
    } catch (err) {
      console.log('LIVE_SKIPPED ' + name + ': ' + ((err && err.message) || String(err)));
    }
  }

  await liveResolve('wy VIP song (晴天/周杰伦)', {
    source: 'wy', songId: '186016', quality: 'exhigh',
    name: '晴天', artist: '周杰伦', duration: 269000,
  });
  await liveResolve('tx song (晴天/周杰伦)', {
    source: 'tx', songId: '0039MnYb0qxYhV', quality: 'exhigh',
    name: '晴天', artist: '周杰伦', duration: 269000,
  });

  // ---------------------------------------------------------------- result
  const failed = results.some(function (t) { return !t.pass; });
  if (failed) {
    console.log('SMOKE_RESULT: FAIL');
    process.exitCode = 1;
  } else {
    console.log('SMOKE_RESULT: PASS');
    process.exitCode = 0;
  }
})().catch(function (err) {
  console.error('SMOKE_ERROR: ' + ((err && err.stack) || err));
  console.log('SMOKE_RESULT: FAIL');
  process.exitCode = 1;
});
