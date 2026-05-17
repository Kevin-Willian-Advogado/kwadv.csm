alter table public.site_settings
  add column if not exists password_recovery_sender_email character varying(180) not null default 'washingtonlopes2003@gmail.com',
  add column if not exists user_validation_sender_email character varying(180) not null default 'washingtonlopes2003@gmail.com',
  add column if not exists contact_notification_sender_email character varying(180) not null default 'washingtonlopes2003@gmail.com',
  add column if not exists contact_notification_cc_recipients text[] not null default array[]::text[];

update public.site_settings
set
  password_recovery_sender_email = 'washingtonlopes2003@gmail.com',
  user_validation_sender_email = 'washingtonlopes2003@gmail.com',
  contact_notification_sender_email = 'washingtonlopes2003@gmail.com',
  email_sender_address = 'washingtonlopes2003@gmail.com',
  contact_notification_recipients = array['washingtonlopes2003@gmail.com']::text[],
  contact_notification_cc_recipients = array['washingtonlopes2003@gmail.com']::text[],
  contact_confirmation_subject = 'Recebemos seu contato',
  contact_confirmation_body = '',
  contact_notification_subject = 'Novo contato recebido pelo site',
  updated_at = now()
where id = 1;
