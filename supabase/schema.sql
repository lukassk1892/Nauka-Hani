-- Nauka Hani: schemat bazy (Supabase / Postgres). Wersja robocza 4.11.2026.
-- Rodzina = Hania + rodzic. Rola ustalana przez rodzica (zaproszenie e-mailem).

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Rodzina',
  tz text not null default 'Europe/Warsaw',
  remind_times text[] not null default array['17:00','19:30'],  -- przypomnienia dla dziecka
  report_time text not null default '21:00',                      -- raport dla rodzica
  goal_min int not null default 60,
  created_at timestamptz default now()
);

create table public.members (
  user_id uuid primary key references auth.users on delete cascade,
  family_id uuid not null references public.families on delete cascade,
  role text not null check (role in ('child','parent')),
  name text not null
);
-- adresy, które przy pierwszym logowaniu dostają rolę (wpisuje rodzic)
create table public.invites (
  email text primary key,
  family_id uuid not null references public.families on delete cascade,
  role text not null check (role in ('child','parent')),
  name text not null
);

-- kopia localStorage dziecka: te same klucze co w aplikacji (czas-nauki-v1, edb-zagrozenia-v1, ...)
create table public.kv (
  user_id uuid not null references auth.users on delete cascade,
  key text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- dzienne podsumowanie liczone w aplikacji dziecka (szybki odczyt dla rodzica i powiadomień)
create table public.days (
  user_id uuid not null references auth.users on delete cascade,
  day date not null,
  active_min int not null default 0,
  coins int not null default 0,
  rounds int not null default 0,
  subjects jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  title text not null,
  price int not null check (price > 0),
  proposed_by_child boolean not null default false,
  active boolean not null default true,
  created_at timestamptz default now()
);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid not null references public.rewards on delete cascade,
  child_id uuid not null references auth.users on delete cascade,
  price int not null,
  status text not null default 'pending' check (status in ('pending','approved','given','declined')),
  created_at timestamptz default now(),
  decided_at timestamptz
);

-- „Brawo” od rodzica, dni wolne, jokery
create table public.events (
  id bigint generated always as identity primary key,
  family_id uuid not null references public.families on delete cascade,
  author uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('cheer','dayoff','bonus')),
  day date,
  amount int,
  message text,
  created_at timestamptz default now()
);

create table public.push_subs (
  endpoint text primary key,
  user_id uuid not null references auth.users on delete cascade,
  sub jsonb not null,
  created_at timestamptz default now()
);

-- dziennik wysłanych powiadomień (żeby nie wysłać dwa razy)
create table public.sent (
  user_id uuid not null,
  day date not null,
  slot text not null,
  primary key (user_id, day, slot)
);

-- ===== RLS =====
alter table public.families enable row level security;
alter table public.members  enable row level security;
alter table public.invites  enable row level security;
alter table public.kv       enable row level security;
alter table public.days     enable row level security;
alter table public.rewards  enable row level security;
alter table public.claims   enable row level security;
alter table public.events   enable row level security;
alter table public.push_subs enable row level security;
alter table public.sent     enable row level security;

create function public.my_family() returns uuid language sql stable security definer set search_path = public as
$$ select family_id from members where user_id = auth.uid() $$;
create function public.am_parent() returns boolean language sql stable security definer set search_path = public as
$$ select exists(select 1 from members where user_id = auth.uid() and role = 'parent') $$;
create function public.same_family(u uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists(select 1 from members where user_id = u and family_id = my_family()) $$;

create policy fam_read on public.families for select using (id = my_family());
create policy fam_upd  on public.families for update using (id = my_family() and am_parent());
create policy mem_read on public.members for select using (family_id = my_family());
create policy inv_all  on public.invites for all using (family_id = my_family() and am_parent()) with check (family_id = my_family() and am_parent());

create policy kv_own   on public.kv for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy kv_par   on public.kv for select using (am_parent() and same_family(user_id));
create policy days_own on public.days for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy days_par on public.days for select using (am_parent() and same_family(user_id));

create policy rw_read  on public.rewards for select using (family_id = my_family());
create policy rw_par   on public.rewards for all using (family_id = my_family() and am_parent()) with check (family_id = my_family() and am_parent());
create policy rw_kid   on public.rewards for insert with check (family_id = my_family() and proposed_by_child and active = false);

create policy cl_read  on public.claims for select using (same_family(child_id));
create policy cl_kid   on public.claims for insert with check (child_id = auth.uid() and status = 'pending');
create policy cl_par   on public.claims for update using (am_parent() and same_family(child_id));

create policy ev_read  on public.events for select using (family_id = my_family());
create policy ev_par   on public.events for insert with check (family_id = my_family() and am_parent() and author = auth.uid());

create policy ps_own   on public.push_subs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- pierwsze logowanie: nadaj rolę z zaproszenia
create function public.claim_invite() returns members language plpgsql security definer set search_path = public as $$
declare i invites; m members;
begin
  select * into m from members where user_id = auth.uid();
  if found then return m; end if;
  select * into i from invites where lower(email) = lower(auth.jwt()->>'email');
  if not found then raise exception 'brak zaproszenia'; end if;
  insert into members values (auth.uid(), i.family_id, i.role, i.name) returning * into m;
  return m;
end $$;

alter publication supabase_realtime add table public.days, public.claims, public.events;

-- ===== Utwardzenie (4.11.2026) =====
-- cena zgłoszenia zawsze z nagrody (dziecko nie może podać własnej)
create function public.claim_price() returns trigger language plpgsql security definer set search_path = public as $$
begin
  select price into new.price from rewards where id = new.reward_id and active and family_id = my_family();
  if new.price is null then raise exception 'nieaktywna nagroda'; end if;
  return new;
end $$;
create trigger claims_price before insert on public.claims for each row execute function public.claim_price();
alter policy cl_par on public.claims with check (am_parent() and same_family(child_id));

revoke execute on function public.my_family(), public.am_parent(), public.same_family(uuid), public.claim_invite(), public.claim_price() from public, anon;
grant execute on function public.my_family(), public.am_parent(), public.same_family(uuid), public.claim_invite() to authenticated;

-- ===== Migracja funkcje_pomocnicze_prywatne (4.11.2026) =====
create schema if not exists private;
grant usage on schema private to authenticated;
alter function public.my_family() set schema private;
alter function public.am_parent() set schema private;
alter function public.same_family(uuid) set schema private;
alter function public.claim_price() set schema private;
alter function private.my_family() set search_path = public, private;
alter function private.same_family(uuid) set search_path = public, private;
alter function private.claim_price() set search_path = public, private;
revoke execute on function private.claim_price() from authenticated;
comment on table public.sent is 'Tylko dla funkcji powiadomień (service role) – celowo bez polityk.';
alter table public.families alter column remind_times set default array['16:00','17:30','19:00'];
-- Rodzina i zaproszenia (e-maile) wpisane osobno, nie są w repozytorium.
