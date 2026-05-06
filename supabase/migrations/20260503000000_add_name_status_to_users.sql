alter table public.users
  add column if not exists name character varying(200);

update public.users
set name = split_part(email, '@', 1)
where name is null or btrim(name) = '';

alter table public.users
  alter column name set default '',
  alter column name set not null;

alter table public.users
  add column if not exists status boolean;

update public.users
set status = true
where status is null;

alter table public.users
  alter column status set default true,
  alter column status set not null;
