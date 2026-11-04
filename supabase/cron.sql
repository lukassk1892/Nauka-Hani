-- Klucze VAPID (tylko dla funkcji notify, bez dostępu z aplikacji)
create table if not exists public.app_secrets (name text primary key, value jsonb not null);
alter table public.app_secrets enable row level security;
comment on table public.app_secrets is 'Tylko dla funkcji (service role) – celowo bez polityk.';
-- Powiadomienia co 15 minut
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('nauka-notify', '*/15 * * * *',
  $$select net.http_post(url := 'https://pzzfpqrlauljsxrbpnxd.supabase.co/functions/v1/notify', headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb)$$);
