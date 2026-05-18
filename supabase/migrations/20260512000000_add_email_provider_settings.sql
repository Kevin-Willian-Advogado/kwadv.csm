alter table public.site_settings
  add column if not exists email_provider character varying(20) not null default 'disabled',
  add column if not exists email_from_name character varying(120) not null default 'Kevin Willian Advogado',
  add column if not exists email_from_address character varying(180) not null default 'washingtonlopes2003@gmail.com',
  add column if not exists email_reply_to character varying(180) not null default '',
  add column if not exists email_smtp_host character varying(180) not null default '',
  add column if not exists email_smtp_port integer not null default 587,
  add column if not exists email_smtp_security character varying(20) not null default 'starttls',
  add column if not exists email_smtp_username character varying(180) not null default '',
  add column if not exists email_smtp_password_secret text not null default '',
  add column if not exists email_last_test_at timestamp with time zone,
  add column if not exists email_last_test_status character varying(20) not null default '',
  add column if not exists email_last_test_error text not null default '';

update public.site_settings
set
  email_provider = case
    when nullif(email_provider, '') is null then 'disabled'
    else email_provider
  end,
  email_from_name = coalesce(nullif(email_from_name, ''), nullif(email_sender_name, ''), 'Kevin Willian Advogado'),
  email_from_address = coalesce(
    nullif(email_from_address, ''),
    nullif(contact_notification_sender_email, ''),
    nullif(email_sender_address, ''),
    'washingtonlopes2003@gmail.com'
  ),
  email_smtp_port = coalesce(nullif(email_smtp_port, 0), 587),
  email_smtp_security = coalesce(nullif(email_smtp_security, ''), 'starttls'),
  updated_at = now()
where id = 1;
