import assert from 'node:assert/strict';
import test from 'node:test';
import { isNyaaSite, sendMessageToNyaaTabs } from '../../src/chrome/shared/domains.js';
import { initSettingsRelay } from '../../src/chrome/background/settings-sync.js';

test('site routing checks the actual HTTP hostname, not path/query text or lookalikes', () => {
  for (const url of ['https://nyaa.si/','https://sukebei.nyaa.si/settings','https://nyaa.ink/']) assert.equal(isNyaaSite(url), true, url);
  for (const url of ['https://nyaa.si.example.test/','https://example.test/?q=nyaa.si','https://nyaa.si@example.test/','file://nyaa.si/settings','invalid',null]) assert.equal(isNyaaSite(url), false, url);
});

test('content scripts relay notifications without a tabs API and surface a relay failure', async () => {
  let received;
  globalThis.chrome = { runtime:{ sendMessage:async message => { received=message;return {ok:true}; } } };
  const message = {type:'settingChanged',setting:'showButtons',value:false};
  await sendMessageToNyaaTabs(message);
  assert.deepEqual(received,{ type:'relaySettings',message });
  chrome.runtime.sendMessage=async()=>({ok:false,error:'unavailable'});
  await assert.rejects(sendMessageToNyaaTabs(message),/unavailable/);
});

test('background derives source tab from sender, tolerates closed targets, and rejects unrelated relay types', async () => {
  let listener;
  const sent=[];
  globalThis.chrome={ runtime:{ id:'our-extension',onMessage:{addListener:fn=>{listener=fn;}}},tabs:{
    query:async()=>[{id:1},{id:2},{id:3}],
    sendMessage:async(id,message)=>{sent.push([id,message]);if(id===3)throw new Error('tab closed');},
  }};
  initSettingsRelay();
  const message={type:'settingChanged',setting:'showButtons',value:false};
  const response=await new Promise(resolve=>listener({type:'relaySettings',message,excludeTabId:2},{id:'our-extension',tab:{id:1}},resolve));
  assert.deepEqual(response,{ok:true});
  assert.deepEqual(sent.map(([id])=>id),[2,3]);
  for(const [id,type] of [['other-extension','settingChanged'],['our-extension','sendTorrent']]) {
    const response=await new Promise(resolve=>listener({type:'relaySettings',message:{type}},{id},resolve));
    assert.equal(response.ok,false);
  }
  assert.equal(sent.length,2);
});
