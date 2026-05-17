alter table public.users
  add column if not exists auth_user_id uuid;

create unique index if not exists ix_users_auth_user_id
  on public.users (auth_user_id)
  where auth_user_id is not null;
