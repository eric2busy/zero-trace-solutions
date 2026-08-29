-- PREPARED ONLY: do not apply this migration to any Supabase project without
-- explicit owner approval. It adds no live-data migration, writer, or reader.
-- Existing website, Notion, Calendar, and email flows remain authoritative.

create type public.command_party_status as enum ('active', 'archived');
create type public.command_contact_kind as enum ('email', 'phone', 'other');

-- Organizations are optional: an individual customer may have no company.
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 1 and 160),
  legal_name text check (legal_name is null or char_length(legal_name) between 1 and 200),
  status public.command_party_status not null default 'active',
  notion_page_id text unique,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.actors(id) on delete restrict,
  updated_by uuid references public.actors(id) on delete restrict,
  version integer not null default 1 check (version > 0)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete restrict,
  display_name text not null check (char_length(display_name) between 1 and 160),
  status public.command_party_status not null default 'active',
  notion_page_id text unique,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.actors(id) on delete restrict,
  updated_by uuid references public.actors(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  unique (id, organization_id)
);

-- A contact belongs to exactly one customer or organization. Raw values are PII;
-- normalized values support later idempotent matching but no browser reads exist.
create table public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete restrict,
  kind public.command_contact_kind not null,
  value text not null check (char_length(value) between 1 and 320),
  normalized_value text not null check (char_length(normalized_value) between 1 and 320),
  label text check (label is null or char_length(label) <= 80),
  is_primary boolean not null default false,
  consent_status text not null default 'unknown' check (consent_status in ('unknown', 'granted', 'withdrawn')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.actors(id) on delete restrict,
  updated_by uuid references public.actors(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  check ((customer_id is null) <> (organization_id is null)),
  unique (customer_id, kind, normalized_value),
  unique (organization_id, kind, normalized_value)
);

-- PostgreSQL supplies the installed IANA timezone database. Keep the validation
-- in a stable function so the table constraint can safely consult that catalog.
create function public.command_is_iana_timezone(candidate text)
returns boolean
language sql
stable
strict
set search_path = pg_catalog
as $$
  select candidate = 'UTC' or (
    candidate ~ '^[A-Za-z][A-Za-z0-9._+-]*(/[A-Za-z][A-Za-z0-9._+-]*)+$'
    and exists (select 1 from pg_timezone_names where name = candidate)
  );
$$;

create table public.service_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete restrict,
  label text not null check (char_length(label) between 1 and 120),
  address_line_1 text not null check (char_length(address_line_1) between 1 and 200),
  address_line_2 text check (address_line_2 is null or char_length(address_line_2) <= 200),
  city text not null check (char_length(city) between 1 and 120),
  region text not null check (char_length(region) between 1 and 120),
  postal_code text not null check (char_length(postal_code) between 1 and 32),
  country_code text not null default 'US' check (country_code ~ '^[A-Z]{2}$'),
  timezone text check (timezone is null or public.command_is_iana_timezone(timezone)),
  status public.command_party_status not null default 'active',
  notion_page_id text unique,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.actors(id) on delete restrict,
  updated_by uuid references public.actors(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  check (organization_id is not null or customer_id is not null),
  -- When both owners are supplied, they must describe the same relationship.
  foreign key (customer_id, organization_id)
    references public.customers (id, organization_id) on delete restrict
);

create unique index customer_contacts_primary_customer_kind_idx on public.customer_contacts (customer_id, kind)
  where is_primary and customer_id is not null;
create unique index customer_contacts_primary_organization_kind_idx on public.customer_contacts (organization_id, kind)
  where is_primary and organization_id is not null;
create index customers_organization_id_idx on public.customers (organization_id) where organization_id is not null;
create index service_locations_organization_id_idx on public.service_locations (organization_id) where organization_id is not null;
create index service_locations_customer_id_idx on public.service_locations (customer_id) where customer_id is not null;

create trigger command_touch_organizations_updated_at before update on public.organizations
  for each row execute procedure public.command_touch_updated_at();
create trigger command_touch_customers_updated_at before update on public.customers
  for each row execute procedure public.command_touch_updated_at();
create trigger command_touch_customer_contacts_updated_at before update on public.customer_contacts
  for each row execute procedure public.command_touch_updated_at();
create trigger command_touch_service_locations_updated_at before update on public.service_locations
  for each row execute procedure public.command_touch_updated_at();

alter table public.organizations enable row level security;
alter table public.customers enable row level security;
alter table public.customer_contacts enable row level security;
alter table public.service_locations enable row level security;
revoke all on table public.organizations, public.customers, public.customer_contacts, public.service_locations from anon, authenticated;
create policy "No direct organization access" on public.organizations as restrictive for all to authenticated using (false) with check (false);
create policy "No direct customer access" on public.customers as restrictive for all to authenticated using (false) with check (false);
create policy "No direct customer contact access" on public.customer_contacts as restrictive for all to authenticated using (false) with check (false);
create policy "No direct service location access" on public.service_locations as restrictive for all to authenticated using (false) with check (false);

comment on table public.organizations is 'Canonical organization identity. No current production flow reads or writes this table.';
comment on table public.customers is 'Canonical customer identity. No current production flow reads or writes this table.';
comment on table public.customer_contacts is 'PII-bearing contact points. Browser access is denied; future service APIs must redact logs.';
comment on table public.service_locations is 'Service-site addresses. Calendar remains schedule authority until a separately approved cutover.';
comment on function public.command_is_iana_timezone(text) is 'Validates UTC or an installed IANA timezone name for future Scheduling use.';
comment on schema public is 'Command authorization remains in trusted auth app metadata and command_roles; never use user_metadata for authorization.';
