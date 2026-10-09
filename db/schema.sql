-- Moorestown Permits schema. The app creates these tables on first use;
-- run this yourself if the database user cannot create tables.

create table if not exists applications (
  ref         text primary key,
  owner_id    text not null,
  status      text not null,
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  data        jsonb not null
);
create index if not exists applications_owner_idx on applications (owner_id, created_at desc);
create index if not exists applications_created_idx on applications (created_at desc);

create table if not exists rate_limits (
  key           text primary key,
  window_start  bigint not null,
  count         integer not null
);
