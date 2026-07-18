create extension if not exists pgcrypto;

create table if not exists public.ota_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null unique check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  file_path text not null unique,
  file_size bigint not null check (file_size > 0 and file_size <= 8388608),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  notes text not null default '',
  active boolean not null default false,
  created_at timestamptz not null default now(),
  activated_at timestamptz
);

create unique index if not exists ota_one_active_release
  on public.ota_releases (active) where active = true;

create table if not exists public.ota_devices (
  id text primary key,
  current_version text,
  target_version text,
  status text not null default 'unknown'
    check (status in ('unknown', 'idle', 'downloading', 'installing', 'success', 'failed')),
  last_seen timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create table if not exists public.ota_secrets (
  key text primary key,
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);

alter table public.ota_releases enable row level security;
alter table public.ota_devices enable row level security;
alter table public.ota_secrets enable row level security;

-- Bilerek politika tanımlanmaz: tablolara yalnızca service-role kullanan
-- `ota` Edge Function erişebilir.
insert into public.ota_devices (id) values ('door-controller')
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('firmware', 'firmware', false, 8388608, array['application/octet-stream'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Yönetici ve cihaz anahtarlarını üretip SHA-256 özetlerini ayrı bir özel
-- dağıtım adımında ota_secrets tablosuna ekleyin. Düz anahtarları SQL'e yazmayın.
