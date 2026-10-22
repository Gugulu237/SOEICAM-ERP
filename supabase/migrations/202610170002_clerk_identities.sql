-- Keep authentication-provider identities separate from legacy ERP user IDs.
create table if not exists erp_private.auth_identities (
  provider text not null check (provider = 'clerk'),
  subject text not null,
  erp_user_id text not null references public."user"(id) on delete restrict,
  verified_email text not null,
  linked_at timestamptz not null default now(),
  primary key (provider, subject),
  unique (provider, erp_user_id)
);
revoke all on erp_private.auth_identities from public, anon, authenticated;
grant all on erp_private.auth_identities to service_role;
