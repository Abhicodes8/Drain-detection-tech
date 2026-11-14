import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {isDeepStrictEqual} from 'node:util';
import {appendMeasurements} from '../src/records-domain.js';
import {SupabaseRecordStore} from '../src/records-storage.js';
import {point,time,EMPTY} from './helpers/drainage-fixtures.js';

const monitoring=(extra={})=>({record_id:randomUUID(),fixture_id:'sink',data_source:'sensor',record_type:'monitoring',recording_status:'recording',schema_version:2,calibration:{empty_distance_mm:EMPTY},measurements:[],result:null,created_at:new Date(time).toISOString(),...extra});
const feed=(record,readings)=>{let current=record,kept=0;for(const p of readings){const r=appendMeasurements(current,[p]);if(r.record!==current)kept++;current=r.record;}return{record:current,kept};};
const idle=(from,seconds,every=500)=>Array.from({length:Math.round(seconds*1000/every)},(_,i)=>point(from+i*every,((i*7)%5-2)*.5));

// ---- Supabase store: incremental reads
function database({delta=true}={}){
 const rows=[],traffic={full:0,fullBytes:0,delta:0,deltaBytes:0,headers:0};
 const fetcher=async(url,o={})=>{
  const q=new URL(url),method=o.method||'GET';
  if(q.pathname.endsWith('/rpc/update_drain_record_compact')){const {p_record_id,p_expected,p_changes}=JSON.parse(o.body),row=rows.find(r=>r.record_id===p_record_id);
   if(!row||!Object.entries(p_expected).every(([k,v])=>isDeepStrictEqual(row[k],v)))return Response.json([]);Object.assign(row,structuredClone(p_changes));row.revision++;return Response.json([{record_id:row.record_id,revision:row.revision}]);}
  if(q.pathname.endsWith('/rpc/drain_record_delta')){
   traffic.delta++;
   if(!delta)return new Response('{}',{status:404});
   const {p_record_id,p_after}=JSON.parse(o.body),row=rows.find(r=>r.record_id===p_record_id),out=row?[{record_id:row.record_id,revision:row.revision,total:row.measurements.length,tail:row.measurements.filter(e=>e.timestamp>p_after),calibration:row.calibration,result:row.result,recording_status:row.recording_status}]:[];
   traffic.deltaBytes+=JSON.stringify(out).length;return Response.json(out);}
  if(method==='POST'){const row={...JSON.parse(o.body),revision:0};rows.push(structuredClone(row));return Response.json([row],{status:201});}
  const eq=[...q.searchParams].filter(([k,f])=>f.startsWith('eq.')),r=rows.filter(row=>eq.every(([k,f])=>String(row[k])===f.slice(3)));
  const select=q.searchParams.get('select'),out=select==='*'?r:r.map(row=>Object.fromEntries(select.split(',').map(k=>[k,row[k]])));
  if(select==='*'){traffic.full++;traffic.fullBytes+=JSON.stringify(out).length;}else traffic.headers++;
  return Response.json(out,{headers:{'Content-Range':`0-${out.length-1}/${r.length}`}});
 };
 return{rows,traffic,store:()=>new SupabaseRecordStore('https://x.supabase.co','sb_secret_x',fetcher)};
}
const write=async(store,id,points)=>{const prev=await store.get(id),r=appendMeasurements(prev,points);if(r.record!==prev)assert.equal(await store.compareAndSet(prev,r.record),true);};

test('a worker holding an older copy downloads only new readings, and the result equals a full read',async()=>{
 const db=database(),writer=db.store(),reader=db.store(),id=randomUUID();
 await writer.insert(monitoring({record_id:id}));
 for(let i=0;i<75;i++)await write(writer,id,Array.from({length:20},(_,k)=>point(time+(i*20+k)*500,30+(k%5))));
 const first=await reader.get(id);assert.equal(first.measurements.length,1500);assert.equal(db.traffic.full,1,'cold worker reads the row once');
 const fullBytes=db.traffic.fullBytes;
 for(let round=0;round<20;round++){
  await write(writer,id,[point(time+(1500+round*2)*500,31),point(time+(1501+round*2)*500,32)]);
  const seen=await reader.get(id);
  assert.deepEqual(seen,await writer.get(id),'delta result identical to the writer\'s copy');
 }
 assert.equal(db.traffic.full,1,'no further full-row downloads');assert.equal(db.traffic.delta,20);
 assert.ok(db.traffic.deltaBytes*20<fullBytes,`20 delta reads (${db.traffic.deltaBytes} B) cost under 5% of one full read (${fullBytes} B)`);
});
test('incremental reads carry changed status fields and never lose history',async()=>{
 const db=database(),writer=db.store(),reader=db.store(),id=randomUUID();
 await writer.insert(monitoring({record_id:id}));
 await write(writer,id,Array.from({length:20},(_,i)=>point(time+i*500,30)));await reader.get(id);
 for(let i=0;i<10;i++){await write(writer,id,Array.from({length:20},(_,k)=>point(time+(20+i*20+k)*500,30+(k%4))));assert.deepEqual((await reader.get(id)).measurements,(await writer.get(id)).measurements);}
 assert.equal((await reader.get(id)).measurements.length,220,'every reading is kept');
 const row=db.rows.find(r=>r.record_id===id);row.recording_status='finished';row.revision++;
 assert.equal((await reader.get(id)).recording_status,'finished','mutable fields come with the delta');
});
test('anything unexpected falls back to the authoritative full read',async()=>{
 // 1. The delta function is not installed yet: still correct, and it is not retried on every read.
 let db=database({delta:false}),writer=db.store(),reader=db.store(),id=randomUUID();
 await writer.insert(monitoring({record_id:id}));await write(writer,id,[point(time,30)]);await reader.get(id);
 for(let i=1;i<6;i++){await write(writer,id,[point(time+i*500,30)]);assert.equal((await reader.get(id)).measurements.length,i+1);}
 assert.equal(db.traffic.delta,1,'one failed attempt, then it stops asking');assert.equal(db.traffic.full,6);
 // 2. A reading older than the cached last one arrives late: the count check catches it.
 db=database();writer=db.store();reader=db.store();id=randomUUID();
 await writer.insert(monitoring({record_id:id}));await write(writer,id,[point(time+5000,30),point(time+5500,30)]);await reader.get(id);
 db.rows[0].measurements.push(point(time+1000,30));db.rows[0].measurements.sort((a,b)=>a.timestamp.localeCompare(b.timestamp));db.rows[0].revision++;
 const seen=await reader.get(id);assert.equal(seen.measurements.length,3);assert.equal(seen.measurements[0].timestamp,new Date(time+1000).toISOString());assert.equal(db.traffic.full,2);
});

