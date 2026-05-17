alter table public.site_settings
  add column if not exists contact_confirmation_sender_email character varying(180) not null default 'washingtonlopes2003@gmail.com';

update public.site_settings
set
  contact_confirmation_sender_email = coalesce(
    nullif(contact_confirmation_sender_email, ''),
    nullif(email_from_address, ''),
    nullif(contact_notification_sender_email, ''),
    nullif(email_sender_address, ''),
    'washingtonlopes2003@gmail.com'
  ),
  updated_at = now()
where id = 1;
