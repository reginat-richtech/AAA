-- 0140_ext_hubspot.sql
-- HubSpot mirror for the web app's data-sync job: deals (with dealstage history),
-- email engagements, owners, and pipeline stages. The alert builder computes the
-- HubSpot "activity brief" from THESE tables (not the live API). The app also
-- creates them on demand (see web/lib/ingest/schema.js), so this is for
-- documentation/consistency — safe to run more than once.

create schema if not exists ext;

create table if not exists ext.hubspot_deal (
  id           text primary key,
  name         text,
  amount       numeric(16,2),
  stage_id     text,
  pipeline_id  text,
  owner_id     text,
  createdate   timestamptz,
  closedate    timestamptz,
  lastmodified timestamptz,
  is_closed    boolean,
  raw          jsonb not null,   -- { properties, stageHistory }
  synced_at    timestamptz not null default now()
);
create index if not exists hubspot_deal_created_idx  on ext.hubspot_deal (createdate desc);
create index if not exists hubspot_deal_modified_idx on ext.hubspot_deal (lastmodified desc);

create table if not exists ext.hubspot_engagement (
  id        text primary key,
  type      text,
  owner_id  text,
  direction text,
  ts        timestamptz,
  raw       jsonb not null,      -- normalized email { subject, body, to[], ... }
  synced_at timestamptz not null default now()
);
create index if not exists hubspot_engagement_ts_idx on ext.hubspot_engagement (ts desc);

create table if not exists ext.hubspot_owner (
  id        text primary key,
  name      text,
  email     text,
  raw       jsonb not null,
  synced_at timestamptz not null default now()
);

create table if not exists ext.hubspot_pipeline (
  stage_id      text primary key,
  pipeline_id   text,
  label         text,
  display_order integer,
  raw           jsonb not null,
  synced_at     timestamptz not null default now()
);
