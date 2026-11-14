import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createCloudHandler} from '../../supabase/functions/_shared/cloud-handler.js';
import {SQLiteRecordStore} from '../src/records-storage.js';
import {createStore} from '../src/storage.js';
import {configFromEnv} from '../src/config.js';
import {SETTINGS} from '../src/records-domain.js';
import {completedEventRows} from '../../supabase/functions/_shared/rollover.js';
import {point,time,EMPTY,DRAIN_DEPTHS} from './helpers/drainage-fixtures.js';

const admin='a'.repeat(32);
async function harness(extra={}){
 const config={...configFromEnv({STORAGE_BACKEND:'sqlite',SQLITE_PATH:':memory:'}),apiKey:admin},store=new SQLiteRecordStore(':memory:'),accessStore=createStore(config);
 Object.assign(store,extra);
 const handler=createCloudHandler({adminToken:admin},{store,accessStore,clock:()=>Date.now(),verifyUser:async()=>null});
 const call=async(path,token,body)=>{const r=await handler(new Request('https://test/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}));const text=await r.text();return{status:r.status,text,data:JSON.parse(text)};};
 assert.equal((await call('/devices',admin,{device_id:'sink',name:'Kitchen'})).status,201);
 const key=(await call('/devices/sink/keys',admin,{})).data.key;
 return{store,call,key};
}
const monitoring=(measurements,extra={})=>({record_id:randomUUID(),fixture_id:'sink',record_type:'monitoring',data_source:'sensor',recording_status:'recording',calibration:{empty_distance_mm:EMPTY},measurements,result:null,created_at:new Date(time-9e6).toISOString(),...extra});
const readings=(n,from=0,depth=0)=>Array.from({length:n},(_,i)=>point(time+(from+i)*500,depth));

test('a full monitoring recording continues in a new one without the board noticing',async()=>{
 const {store,call,key}=await harness(),A=monitoring(readings(SETTINGS.maxMeasurements-1));await store.insert(A);
 // A batch that would overflow rolls over first instead of being half-applied and rejected.
 const first=await call(`/records/${A.record_id}/measurements`,key,{measurements:readings(2,SETTINGS.maxMeasurements)});
 assert.equal(first.status,201);
 // What the firmware checks before it clears its pending point: its own record id and a recording status.
 assert.ok(first.text.includes(`"record_id":"${A.record_id}"`));assert.ok(first.text.includes('"recording_status":"recording"'));
 const B=first.data.continued_in;assert.ok(B&&B!==A.record_id);
 const old=await store.get(A.record_id),next=await store.get(B);
 assert.equal(old.recording_status,'finished');assert.equal(old.measurements.length,SETTINGS.maxMeasurements-1,'nothing is lost or deleted from the old recording');
 assert.equal(next.recording_status,'recording');assert.equal(next.record_type,'monitoring');assert.equal(next.measurements.length,2);assert.deepEqual(next.calibration,{empty_distance_mm:EMPTY});
 // The board keeps posting to its original id and is forwarded to the same current recording.
 const second=await call(`/records/${A.record_id}/measurements`,key,{measurements:readings(3,SETTINGS.maxMeasurements+2)});
 assert.equal(second.status,201);assert.equal(second.data.continued_in,B);assert.equal((await store.get(B)).measurements.length,5);
 assert.equal((await store.list({fixture_id:'sink',recording_status:'recording'},10)).length,1,'exactly one active recording');
 // An ordinary recording is untouched.
 const small=monitoring(readings(10),{fixture_id:'sink'});await store.compareAndSet(await store.get(B),{...(await store.get(B)),recording_status:'finished'});await store.insert(small);
 const normal=await call(`/records/${small.record_id}/measurements`,key,readings(1,100)[0]);assert.equal(normal.status,201);assert.equal(normal.data.continued_in,undefined);
});
test('a user-finished short recording is never forwarded, and a calibration is never mixed into',async()=>{
 const {store,call,key}=await harness(),done=monitoring(readings(50),{recording_status:'finished'});await store.insert(done);
 assert.equal((await call(`/records/${done.record_id}/measurements`,key,readings(1,60)[0])).status,409,'finished recordings still refuse readings');
 const full=monitoring(readings(SETTINGS.maxMeasurements));await store.insert(full);
 const other=await call('/records',admin,{fixture_id:'sink',record_type:'calibration',data_source:'sensor',confirm_empty:true});assert.equal(other.status,409,'only one active recording per unit');
});

test('each completed drain is saved once, and the history endpoint returns bounded points',async()=>{
 const saved=[],asked=[];
 const {store,call,key}=await harness({saveDrainEvents:async rows=>{saved.push(...rows);},drainHistory:async(...args)=>{asked.push(args);return[{t:'2026-11-14T00:00:00Z',avg_seconds:4,min_seconds:4,max_seconds:4,n:1}];}});
 const M=monitoring([]);await store.insert(M);
 const drain=[...readings(8,0,0),...DRAIN_DEPTHS.map((d,i)=>point(time+(8+i)*500,d)),...readings(10,8+DRAIN_DEPTHS.length,0)];
 for(let i=0;i<drain.length;i+=4)assert.equal((await call(`/records/${M.record_id}/measurements`,key,{measurements:drain.slice(i,i+4)})).status,201);
 assert.equal(saved.length,1,'one completed drain, saved exactly once');
 assert.equal(saved[0].fixture_id,'sink');assert.equal(saved[0].record_id,M.record_id);assert.ok(saved[0].seconds>0);assert.match(saved[0].event_id,new RegExp(`^${M.record_id}:`));
 assert.deepEqual(completedEventRows(await store.get(M.record_id)).map(r=>r.event_id),[saved[0].event_id]);
 // history: validated range, access required, bounded point count passed to the database
 const ok=await call('/history?fixture_id=sink&data_source=sensor&range=1w',admin);assert.equal(ok.status,200);assert.equal(ok.data.points.length,1);
 assert.equal(asked[0][0],'sink');assert.equal(asked[0][1],'sensor');assert.equal(asked[0][3],160);
 assert.ok(Math.abs(Date.parse(asked[0][2])-(Date.now()-7*86400000))<5000);
 const all=await call('/history?fixture_id=sink&range=all',admin);assert.equal(asked.at(-1)[2],new Date(0).toISOString());
 assert.equal((await call('/history?fixture_id=sink&range=5y',admin)).status,422);
 assert.equal((await call('/history?fixture_id=sink&range=1w','nope')).status,401);
 assert.equal((await call('/history?fixture_id=bad id!',admin)).status,422);
 const plain=await harness();assert.equal((await plain.call('/history?fixture_id=sink&range=1w',admin)).data.error.code,'history_unavailable');
});
