insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'images',
  'images',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public read images'
  ) then
    create policy "Public read images"
      on storage.objects
      for select
      to public
      using (bucket_id = 'images');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Authenticated users can upload images'
  ) then
    create policy "Authenticated users can upload images"
      on storage.objects
      for insert
      to authenticated
      with check (bucket_id = 'images');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Authenticated users can update images'
  ) then
    create policy "Authenticated users can update images"
      on storage.objects
      for update
      to authenticated
      using (bucket_id = 'images')
      with check (bucket_id = 'images');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Authenticated users can delete images'
  ) then
    create policy "Authenticated users can delete images"
      on storage.objects
      for delete
      to authenticated
      using (bucket_id = 'images');
  end if;
end $$;
