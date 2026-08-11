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
    const rejected = m._test.validateUrl(
      'http://panspace.kuwo.cn/f2afa55a304638d524fe825bf745704a/x/y.mp3',
      '无法获取播放链接！');
    const accepted = m._test.validateUrl('https://example.com/a.mp3', 'ok');
    const pass = rejected === false && accepted === true;
    record('T2 validateUrl rejects placeholder / accepts clean', pass,
      pass ? '' : 'reject(placeholder)=' + rejected + ' accept(clean)=' + accepted);
  } catch (e) {
    record('T2 validateUrl rejects placeholder / accepts clean', false, String((e && e.message) || e));
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
    const pass = standard === '128k' && exhigh === '320k' && hires === 'flac24bit' && losslessClamped === '320k';
    record('T3 quality mapping + clamp', pass,
      pass ? '' : JSON.stringify({ standard: standard, exhigh: exhigh, hires: hires, losslessClamped: losslessClamped }));
  } catch (e) {
    record('T3 quality mapping + clamp', false, String((e && e.message) || e));
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

  await liveResolve('kg', { source: 'kg', songId: '6C5C0DD1B0D1E4A5F4E7D2F76D1E2D3A', quality: 'exhigh' });
  await liveResolve('wy', { source: 'wy', songId: '186016', quality: '128k' });

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
