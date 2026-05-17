alter table public.contact_messages
  add column if not exists confirmation_sender_email character varying(180) not null default 'washingtonlopes2003@gmail.com',
  add column if not exists confirmation_recipient_email character varying(180) not null default '',
  add column if not exists notification_sender_email character varying(180) not null default 'washingtonlopes2003@gmail.com',
  add column if not exists notification_recipient_emails text[] not null default array['washingtonlopes2003@gmail.com']::text[],
  add column if not exists notification_cc_emails text[] not null default array['washingtonlopes2003@gmail.com']::text[];

update public.contact_messages
set
  confirmation_sender_email = coalesce(nullif(confirmation_sender_email, ''), 'washingtonlopes2003@gmail.com'),
  confirmation_recipient_email = coalesce(nullif(confirmation_recipient_email, ''), email),
  notification_sender_email = coalesce(nullif(notification_sender_email, ''), 'washingtonlopes2003@gmail.com'),
  notification_recipient_emails = case
    when cardinality(notification_recipient_emails) = 0 then array['washingtonlopes2003@gmail.com']::text[]
    else notification_recipient_emails
  end,
  notification_cc_emails = case
    when cardinality(notification_cc_emails) = 0 then array['washingtonlopes2003@gmail.com']::text[]
    else notification_cc_emails
  end;
