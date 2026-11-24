-- TravelPlan Supabase 스키마 (이미 적용됨: migration "travel_plan_schema")
-- 새 프로젝트에 다시 만들 때만 SQL Editor에 통째로 붙여넣고 Run 하세요.
-- 기존 GPX Tracker 테이블(gpx_tracks, gpx_waypoints2)은 건드리지 않습니다.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  start_date date not null,
  end_date date not null,
  share_token text not null unique
    default (replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')),
  share_enabled boolean not null default true,
  share_can_edit boolean not null default true,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table public.trip_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day date not null,
  end_day date,
  start_time time,
  end_time time,
  title text not null check (char_length(title) between 1 and 200),
  kind text not null default 'other' check (kind in ('olle','flight','stay','meal','other')),
  course_id text check (course_id is null or char_length(course_id) <= 10),
  note text check (note is null or char_length(note) <= 2000),
  created_by text not null default 'owner' check (created_by in ('owner','guest')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_day is null or end_day >= day)
);
create index trip_events_trip_day_idx on public.trip_events (trip_id, day);

create table public.course_routes (
  trip_id uuid not null references public.trips(id) on delete cascade,
  course_id text not null check (char_length(course_id) <= 10),
  path jsonb not null,
  point_count int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (trip_id, course_id)
);

create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger trip_events_touch before update on public.trip_events
  for each row execute function private.touch_updated_at();
create trigger course_routes_touch before update on public.course_routes
  for each row execute function private.touch_updated_at();

-- RLS: 소유자만 직접 접근. anon(공유 링크 방문자)은 테이블에 직접 접근할 수 없습니다.
alter table public.trips enable row level security;
alter table public.trip_events enable row level security;
alter table public.course_routes enable row level security;

create policy "owner all" on public.trips for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "owner all" on public.trip_events for all to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_events.trip_id and t.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.trips t where t.id = trip_events.trip_id and t.owner_id = (select auth.uid())));
create policy "owner all" on public.course_routes for all to authenticated
  using (exists (select 1 from public.trips t where t.id = course_routes.trip_id and t.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.trips t where t.id = course_routes.trip_id and t.owner_id = (select auth.uid())));

revoke all on public.trips, public.trip_events, public.course_routes from anon;
grant select, insert, update, delete on public.trips, public.trip_events, public.course_routes to authenticated;

-- 공유 토큰 확인(내부용, API로 노출되지 않음)
create or replace function private.trip_for_token(p_token text)
returns public.trips language sql stable security definer set search_path = '' as $$
  select t.* from public.trips t
  where t.share_enabled and p_token is not null and t.share_token = p_token limit 1
$$;
revoke all on function private.trip_for_token(text) from public;

-- 공유 링크용 RPC: 토큰이 맞을 때만 동작
create or replace function public.shared_bundle(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.trips;
begin
  select * into t from private.trip_for_token(p_token);
  if t.id is null then return null; end if;
  return jsonb_build_object(
    'trip', jsonb_build_object('id', t.id, 'title', t.title, 'start_date', t.start_date,
                               'end_date', t.end_date, 'can_edit', t.share_can_edit),
    'events', coalesce((select jsonb_agg(to_jsonb(e) - 'trip_id' order by e.day, e.start_time nulls first)
                        from public.trip_events e where e.trip_id = t.id), '[]'::jsonb));
end $$;

create or replace function public.shared_routes(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.trips;
begin
  select * into t from private.trip_for_token(p_token);
  if t.id is null then return null; end if;
  return coalesce((select jsonb_object_agg(r.course_id, r.path)
                   from public.course_routes r where r.trip_id = t.id), '{}'::jsonb);
end $$;

create or replace function public.shared_event_save(p_token text, p_event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.trips; v_id uuid; r public.trip_events;
begin
  select * into t from private.trip_for_token(p_token);
  if t.id is null then raise exception 'invalid_token' using errcode = '28000'; end if;
  if not t.share_can_edit then raise exception 'read_only' using errcode = '42501'; end if;
  v_id := nullif(p_event->>'id', '')::uuid;
  if v_id is not null then
    update public.trip_events set
      day = (p_event->>'day')::date,
      end_day = nullif(p_event->>'end_day', '')::date,
      start_time = nullif(p_event->>'start_time', '')::time,
      end_time = nullif(p_event->>'end_time', '')::time,
      title = p_event->>'title',
      kind = coalesce(nullif(p_event->>'kind', ''), 'other'),
      course_id = nullif(p_event->>'course_id', ''),
      note = nullif(p_event->>'note', '')
    where id = v_id and trip_id = t.id
    returning * into r;
    if r.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  else
    if (select count(*) from public.trip_events where trip_id = t.id) >= 500 then
      raise exception 'too_many_events' using errcode = '54000';
    end if;
    insert into public.trip_events (trip_id, day, end_day, start_time, end_time, title, kind, course_id, note, created_by)
    values (t.id, (p_event->>'day')::date, nullif(p_event->>'end_day', '')::date,
            nullif(p_event->>'start_time', '')::time, nullif(p_event->>'end_time', '')::time,
            p_event->>'title', coalesce(nullif(p_event->>'kind', ''), 'other'),
            nullif(p_event->>'course_id', ''), nullif(p_event->>'note', ''), 'guest')
    returning * into r;
  end if;
  return to_jsonb(r) - 'trip_id';
end $$;

create or replace function public.shared_event_delete(p_token text, p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare t public.trips; n int;
begin
  select * into t from private.trip_for_token(p_token);
  if t.id is null then raise exception 'invalid_token' using errcode = '28000'; end if;
  if not t.share_can_edit then raise exception 'read_only' using errcode = '42501'; end if;
  delete from public.trip_events where id = p_id and trip_id = t.id;
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function public.shared_bundle(text), public.shared_routes(text),
  public.shared_event_save(text, jsonb), public.shared_event_delete(text, uuid) from public;
grant execute on function public.shared_bundle(text), public.shared_routes(text),
  public.shared_event_save(text, jsonb), public.shared_event_delete(text, uuid) to anon, authenticated;

-- ============================================================
-- 추가 마이그레이션 trip_events_place: 일정에 장소명·좌표(지도 핀) 저장
-- (위 shared_event_save 를 아래 버전으로 교체. 신규 설치 시 이 파일을 순서대로 실행)
-- ============================================================
alter table public.trip_events
  add column if not exists place text check (place is null or char_length(place) <= 200),
  add column if not exists lat double precision check (lat is null or (lat between -90 and 90)),
  add column if not exists lng double precision check (lng is null or (lng between -180 and 180)),
  add constraint trip_events_latlng_pair check ((lat is null) = (lng is null));

create or replace function public.shared_event_save(p_token text, p_event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.trips; v_id uuid; r public.trip_events;
begin
  select * into t from private.trip_for_token(p_token);
  if t.id is null then raise exception 'invalid_token' using errcode = '28000'; end if;
  if not t.share_can_edit then raise exception 'read_only' using errcode = '42501'; end if;
  v_id := nullif(p_event->>'id', '')::uuid;
  if v_id is not null then
    update public.trip_events set
      day = (p_event->>'day')::date,
      end_day = nullif(p_event->>'end_day', '')::date,
      start_time = nullif(p_event->>'start_time', '')::time,
      end_time = nullif(p_event->>'end_time', '')::time,
      title = p_event->>'title',
      kind = coalesce(nullif(p_event->>'kind', ''), 'other'),
      course_id = nullif(p_event->>'course_id', ''),
      note = nullif(p_event->>'note', ''),
      place = case when p_event ? 'place' then nullif(p_event->>'place', '') else place end,
      lat = case when p_event ? 'lat' then nullif(p_event->>'lat', '')::double precision else lat end,
      lng = case when p_event ? 'lng' then nullif(p_event->>'lng', '')::double precision else lng end
    where id = v_id and trip_id = t.id
    returning * into r;
    if r.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  else
    if (select count(*) from public.trip_events where trip_id = t.id) >= 500 then
      raise exception 'too_many_events' using errcode = '54000';
    end if;
    insert into public.trip_events (trip_id, day, end_day, start_time, end_time, title, kind, course_id, note, place, lat, lng, created_by)
    values (t.id, (p_event->>'day')::date, nullif(p_event->>'end_day', '')::date,
            nullif(p_event->>'start_time', '')::time, nullif(p_event->>'end_time', '')::time,
            p_event->>'title', coalesce(nullif(p_event->>'kind', ''), 'other'),
            nullif(p_event->>'course_id', ''), nullif(p_event->>'note', ''),
            nullif(p_event->>'place', ''), nullif(p_event->>'lat', '')::double precision,
            nullif(p_event->>'lng', '')::double precision, 'guest')
    returning * into r;
  end if;
  return to_jsonb(r) - 'trip_id';
end $$;
