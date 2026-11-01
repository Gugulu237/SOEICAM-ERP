-- Apply through the normal reviewed deployment migration process, never on app startup.
create schema if not exists erp_private;
create table if not exists erp_private.device_push_subscriptions (
  id uuid primary key,
  user_id text not null references public."user"(id) on delete cascade,
  endpoint_hash text not null unique,
  subscription jsonb not null,
  enabled boolean not null default true,
  sound boolean not null default true,
  language text not null default 'fr' check (language in ('fr','en')),
  revision integer not null default 1,
  enabled_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_test_at timestamptz
);
create index if not exists device_push_user_idx on erp_private.device_push_subscriptions(user_id);
create table if not exists erp_private.device_push_deliveries (
  id text primary key,
  subscription_id uuid not null references erp_private.device_push_subscriptions(id) on delete cascade,
  notification_id text not null,
  revision integer not null,
  status text not null default 'pending' check(status in ('pending','sending','sent','skipped','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease uuid,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(subscription_id,revision,notification_id)
);
create index if not exists device_push_pending_idx on erp_private.device_push_deliveries(status,available_at);
revoke all on erp_private.device_push_subscriptions,erp_private.device_push_deliveries from public,anon,authenticated;
grant all on erp_private.device_push_subscriptions,erp_private.device_push_deliveries to service_role;
