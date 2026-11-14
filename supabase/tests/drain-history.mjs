// PGlite regression for drain_events / drain_history. Run like drainage-profile.mjs (see supabase/README.md).
import {pathToFileURL,fileURLToPath} from 'node:url';
const {PGlite}=await import(process.env.PGLITE_MODULE_PATH?pathToFileURL(process.env.PGLITE_MODULE_PATH).href:'@electric-sql/pglite');
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url));
const db=new PGlite();
await db.exec('create role anon;create role authenticated;create role service_role;');
const sql=await readFile(root+'supabase/migrations/202611140003_drain_history.sql','utf8');
await db.exec(sql);await db.exec(sql);                                  // re-runnable
const id=(i)=>`unit:${i}`,rec='00000000-0000-4000-8000-000000000001',day=86400000,t0=Date.parse('2026-01-01T00:00:00Z');
const add=async(fixture,n,seconds)=>{for(let i=0;i<n;i++)await db.query(`insert into drain_events(event_id,fixture_id,data_source,record_id,started_at,seconds)values($1,$2,'sensor',$3,$4,$5)`,[`${fixture}:${i}`,fixture,rec,new Date(t0+i*day/10).toISOString(),seconds(i)]);};
await add('few',30,i=>5+i%3);await add('many',1000,i=>5+i/100);await add('other',5,()=>9);
const hist=async(fixture,since='1970-01-01',points=160)=>(await db.query('select * from drain_history($1,$2,$3,$4)',[fixture,'sensor',since,points])).rows;
// few drains: returned as they are
let rows=await hist('few');assert.equal(rows.length,30);assert.ok(rows.every(r=>r.n===1&&r.min_seconds===r.max_seconds));
// many drains: bounded, nothing lost, extremes kept, in time order
rows=await hist('many');assert.ok(rows.length<=160&&rows.length>=100,`bucketed to ${rows.length}`);
assert.equal(rows.reduce((a,r)=>a+r.n,0),1000);assert.ok(Math.min(...rows.map(r=>r.min_seconds))<5.01);assert.ok(Math.max(...rows.map(r=>r.max_seconds))>14.9);
assert.deepEqual(rows.map(r=>r.t.getTime()),[...rows.map(r=>r.t.getTime())].sort((a,b)=>a-b));
assert.ok(rows.every(r=>r.min_seconds<=r.avg_seconds&&r.avg_seconds<=r.max_seconds));
// the series trends upward, as a slowing drain would
assert.ok(rows.at(-1).avg_seconds>rows[0].avg_seconds+5);
// range filter, isolation per unit and source, tiny payload
assert.equal((await hist('many',new Date(t0+50*day).toISOString())).reduce((a,r)=>a+r.n,0),500);
assert.equal((await hist('other')).length,5);assert.equal((await hist('missing')).length,0);
assert.equal((await db.query('select * from drain_history($1,$2,$3,$4)',['many','simulation','1970-01-01',160])).rows.length,0);
assert.ok(JSON.stringify(await hist('many')).length<30000,'a long history stays tens of KB');
await assert.rejects(db.query(`insert into drain_events(event_id,fixture_id,data_source,record_id,started_at,seconds)values('bad','x','sensor',$1,now(),-1)`,[rec]),/check/);
await assert.rejects(db.query(`insert into drain_events(event_id,fixture_id,data_source,record_id,started_at,seconds)values('few:0','few','sensor',$1,now(),1)`,[rec]),/duplicate key/);
console.log('drain history: ok');
