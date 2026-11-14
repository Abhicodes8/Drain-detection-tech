-- One small row per completed drain, written when the drain finishes, so long-range trend charts read ~100 bytes per
-- drain instead of old recordings. drain_history returns at most p_points rows for any range: the drains themselves
-- when there are few, otherwise min/avg/max per time bucket. Service role only.
begin;
create table if not exists public.drain_events(
  event_id text primary key,
  fixture_id text not null,
  data_source text not null check(data_source in ('sensor','simulation')),
  record_id uuid not null,
  started_at timestamptz not null,
  seconds double precision not null check(seconds>0 and seconds<86400));
create index if not exists drain_events_history on public.drain_events(fixture_id,data_source,started_at desc);
alter table public.drain_events enable row level security;
revoke all on public.drain_events from public,anon,authenticated;
grant select,insert on public.drain_events to service_role;
create or replace function public.drain_history(p_fixture text,p_source text,p_since timestamptz,p_points integer)
returns table(t timestamptz,avg_seconds double precision,min_seconds double precision,max_seconds double precision,n integer)
language sql stable security invoker set search_path=public,pg_temp as $function$
  with ev as (select started_at,seconds from public.drain_events where fixture_id=p_fixture and data_source=p_source and started_at>=p_since),
  b as (select count(*) c,min(started_at) lo,max(started_at) hi from ev),
  raw as (select ev.started_at t,ev.seconds a,ev.seconds mn,ev.seconds mx,1 n from ev,b where b.c<=p_points),
  grp as (select min(ev.started_at) t,avg(ev.seconds) a,min(ev.seconds) mn,max(ev.seconds) mx,count(*)::integer n from ev,b where b.c>p_points
          group by least(p_points-1,floor(extract(epoch from ev.started_at-b.lo)/greatest(extract(epoch from b.hi-b.lo),1)*p_points)::integer))
  select t,a,mn,mx,n from raw union all select t,a,mn,mx,n from grp order by t;
$function$;
revoke all on function public.drain_history(text,text,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.drain_history(text,text,timestamptz,integer) to service_role;
commit;
