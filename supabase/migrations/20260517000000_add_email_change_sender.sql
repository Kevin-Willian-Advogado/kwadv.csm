alter table public.site_settings
  add column if not exists email_change_sender_email character varying(180) not null default 'washingtonlopes2003@gmail.com';

update public.site_settings
set email_change_sender_email = coalesce(
  nullif(email_change_sender_email, ''),
  nullif(user_validation_sender_email, ''),
  nullif(email_from_address, ''),
  nullif(email_sender_address, ''),
  'washingtonlopes2003@gmail.com'
);
