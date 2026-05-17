create table if not exists public.pending_email_changes (
  id bigint generated always as identity primary key,
  public_user_id integer not null references public.users(id) on delete cascade,
  auth_user_id uuid not null,
  previous_email character varying(180) not null,
  new_email character varying(180) not null,
  token_hash character varying(128) not null unique,
  requested_by integer,
  created_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null,
  consumed_at timestamp with time zone
);

create index if not exists pending_email_changes_token_hash_idx
  on public.pending_email_changes(token_hash);

create index if not exists pending_email_changes_active_user_idx
  on public.pending_email_changes(public_user_id)
  where consumed_at is null;

alter table public.pending_email_changes enable row level security;
