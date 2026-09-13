import assert from 'node:assert/strict';
import test from 'node:test';
const local={__neLocalMigrated:true};
let fail=true;
const read=(q)=>Array.isArray(q)?Object.fromEntries(q.filter(k=>k in local).map(k=>[k,local[k]])):Object.fromEntries(Object.entries(q).map(([k,v])=>[k,k in local?local[k]:v]));
globalThis.chrome={runtime:{},storage:{local:{
 get(q,cb){cb(read(q));},
 set(items,cb){if(fail){chrome.runtime.lastError={message:'Synthetic counter write failure'};cb();delete chrome.runtime.lastError;}else{Object.assign(local,items);cb();}},
 remove(keys,cb){cb();},
},sync:{get(q,cb){cb({});},set(items,cb){cb();},remove(keys,cb){cb();}}}};
const {incrementAmeNZBRequestCount}=await import('../../src/chrome/content/features/amenzb/index.js');
test('an integration counter rejects a failed save instead of leaving its caller pending, then can retry',async()=>{
 let timer;
 try {
  await assert.rejects(Promise.race([incrementAmeNZBRequestCount(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('counter remained pending')),500);})]),/Synthetic counter write failure/);
 } finally {clearTimeout(timer);}
 fail=false;
 await incrementAmeNZBRequestCount();
 assert.equal(local.ameNZBRequestCount,1);
});
