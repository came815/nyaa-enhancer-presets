import assert from 'node:assert/strict';
import test from 'node:test';

let instance = 0;
async function prefsHarness({ sync = {}, local = {}, failure } = {}) {
  const operations = [];
  const chrome = { runtime: {}, storage: {} };
  for (const [area, store] of Object.entries({ sync, local })) {
    const call = (method, payload, callback, run) => {
      operations.push({ area, method, payload });
      if (failure?.(area, method, payload)) {
        chrome.runtime.lastError = { message: 'Synthetic storage failure' };
        callback();
        delete chrome.runtime.lastError;
      } else callback(run());
    };
    chrome.storage[area] = {
      get(query, callback) { call('get', query, callback, () => Array.isArray(query)
        ? Object.fromEntries(query.filter(k => Object.hasOwn(store,k)).map(k=>[k,store[k]]))
        : Object.fromEntries(Object.entries(query).map(([k,v])=>[k,Object.hasOwn(store,k)?store[k]:v]))); },
      set(items, callback) { call('set', items, callback, () => Object.assign(store, items)); },
      remove(keys, callback) { call('remove', keys, callback, () => keys.forEach(k => delete store[k])); },
    };
  }
  globalThis.chrome = chrome;
  const prefs = await import(`../../src/chrome/shared/prefs.js?case=${++instance}`);
  return { prefs, sync, local, operations };
}

test('migration preserves newer local values and moves remaining legacy values before deleting synced secrets', async () => {
  const { prefs, sync, local } = await prefsHarness({ sync: { qbtPassword:'legacy', keywords:['legacy'], uiLanguage:'en' }, local:{ qbtPassword:'current' } });
  const result = await prefs.getPreferencesAsync({ qbtPassword:'',keywords:[],uiLanguage:'ja' });
  assert.deepEqual(result,{ qbtPassword:'current',keywords:['legacy'],uiLanguage:'en' });
  assert.equal(local.qbtPassword,'current');
  assert.deepEqual(sync,{ uiLanguage:'en' });
});

test('failed migration retains source data, serves legacy reads and retries before accepting a new save', async () => {
  let fail = true;
  const { prefs, sync, local } = await prefsHarness({ sync:{ qbtPassword:'legacy' }, failure:(area,method)=>fail && area==='local' && method==='set' });
  const read = await prefs.getPreferencesAsync({ qbtPassword:'' });
  assert.equal(read.qbtPassword,'legacy');
  await assert.rejects(prefs.savePreferencesAsync({ qbtPassword:'new' }), /Synthetic/);
  assert.equal(sync.qbtPassword,'legacy');
  assert.equal(local.__neLocalMigrated,undefined);
  fail = false;
  await prefs.savePreferencesAsync({ qbtPassword:'new' });
  assert.equal(local.qbtPassword,'new');
  assert.equal(sync.qbtPassword,undefined);
});

test('a migration interrupted after copying does not overwrite locally changed data on retry', async () => {
  let fail = true;
  const { prefs, sync, local } = await prefsHarness({ sync:{ keywords:['old'] }, failure:(area,method)=>fail && area==='sync' && method==='remove' });
  await prefs.getPreferencesAsync({ keywords:[] });
  local.keywords = ['new'];
  fail = false;
  assert.deepEqual(await prefs.getPreferencesAsync({ keywords:[] }),{ keywords:['new'] });
  assert.equal(sync.keywords,undefined);
});

test('save callback and returned promise never report failed storage writes as success', async () => {
  let fail = true;
  const { prefs, sync } = await prefsHarness({ local:{__neLocalMigrated:true}, failure:(area,method)=>fail && area==='sync' && method==='set' });
  let callbacks = 0;
  await assert.rejects(prefs.savePreferences({ showButtons:false }, () => callbacks++),/Synthetic/);
  await Promise.resolve();
  assert.equal(callbacks,0);
  assert.equal(sync.showButtons,undefined);
  fail = false;
  await prefs.savePreferences({ showButtons:false }, () => callbacks++);
  assert.equal(callbacks,1);
  assert.equal(sync.showButtons,false);
});
