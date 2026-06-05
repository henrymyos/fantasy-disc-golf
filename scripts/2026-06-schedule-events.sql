-- Data-driven DGPT schedule. Replaces the hardcoded lib/dgpt-2026-schedule.ts
-- as the source of truth so future seasons are an INSERT (or the admin editor /
-- cloneSeason), not a code change. Seeded idempotently from the 2026 static
-- list; the static array remains a runtime fallback when this table is empty
-- for a requested season (see lib/schedule.ts getScheduleEvents).
create table if not exists public.schedule_events (
  id            bigint generated always as identity primary key,
  season_year   int  not null,
  slug          text not null,
  name          text not null,
  start_date    date not null,
  end_date      date not null,
  city          text,
  state         text,
  country       text not null default 'USA',
  course        text,
  pdga_event_id int,
  sort_order    int  not null default 0,
  created_at    timestamptz default now(),
  unique (season_year, slug)
);

alter table public.schedule_events enable row level security;

drop policy if exists schedule_events_read on public.schedule_events;
create policy schedule_events_read on public.schedule_events
  for select using (true);

insert into public.schedule_events
  (season_year, slug, name, start_date, end_date, city, state, country, course, pdga_event_id, sort_order)
values
  (2026,'supreme-flight-open','Supreme Flight Open','2026-02-27','2026-03-01','Brooksville','FL','USA','Olympus',96401,0),
  (2026,'big-easy-open','MVP Big Easy Open','2026-03-13','2026-03-15','Jefferson Parish','LA','USA','Parc des Familles',96402,1),
  (2026,'queen-city-classic','Queen City Classic','2026-03-27','2026-03-29','Charlotte','NC','USA','Hornets Nest',96403,2),
  (2026,'champions-cup','PDGA Champions Cup','2026-04-09','2026-04-12','Lynchburg','VA','USA',null,97336,3),
  (2026,'jonesboro-open','Play it Again Sports Jonesboro Open','2026-04-17','2026-04-19','Jonesboro','AR','USA','Disc Side of Heaven',96404,4),
  (2026,'kansas-city-wide-open','GRIPeq 44th Kansas City Wide Open','2026-04-24','2026-04-26','Liberty','MO','USA','Bad Rock Creek',96407,5),
  (2026,'barbasol-open-austin','Barbasol Open at Austin','2026-05-07','2026-05-10','Austin','TX','USA','Harvey Penick, Sprinkle Valley',96408,6),
  (2026,'otb-open','OTB Open','2026-05-21','2026-05-24','Stockton','CA','USA','Swenson Park A & B',96409,7),
  (2026,'northwest-championship','Northwest Championship','2026-06-04','2026-06-07','Portland','OR','USA','Milo McIver, Glendoveer East',96410,8),
  (2026,'european-open','European Open','2026-06-18','2026-06-21','Tallinn',null,'Estonia','Song Festival Grounds',97339,9),
  (2026,'swedish-open','Swedish Open','2026-06-26','2026-06-28','Borås',null,'Sweden',null,96411,10),
  (2026,'ale-open','Ale Open','2026-07-03','2026-07-05','Nol',null,'Sweden',null,96412,11),
  (2026,'heinola-open','Heinola Open','2026-07-10','2026-07-12','Heinola',null,'Finland',null,96413,12),
  (2026,'ledgestone-open','Ledgestone Open','2026-07-30','2026-08-02','Peoria','IL','USA','Eureka Lake, Sunset Hills, Northwood Black',96414,13),
  (2026,'discmania-challenge','Discmania Challenge','2026-08-07','2026-08-09','Indianola','IA','USA','Pickard Park',96415,14),
  (2026,'pdga-pro-worlds','PDGA Pro World Championships','2026-08-26','2026-08-30','Milford','MI','USA',null,97344,15),
  (2026,'lws-open-idlewild','LWS Open at Idlewild','2026-09-04','2026-09-06','Burlington','KY','USA','Idlewild',96417,16),
  (2026,'green-mountain-championship','Green Mountain Championship','2026-09-17','2026-09-20','Jeffersonville','VT','USA','Brewster Ridge, Fox Run Meadows',96418,17),
  (2026,'mvp-open-otb','MVP Open x OTB','2026-09-24','2026-09-27','Leicester','MA','USA','Maple Hill',96419,18),
  (2026,'usdgc','USDGC / Throw Pink Women''s Championship','2026-10-08','2026-10-11','Rock Hill','SC','USA','Winthrop Grounds',97346,19)
on conflict (season_year, slug) do nothing;