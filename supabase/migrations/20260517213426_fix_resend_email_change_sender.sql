alter table public.site_settings
  alter column email_change_sender_email set default 'no-reply@washingtonlopes.com';

update public.site_settings
set email_change_sender_email = coalesce(
  nullif(user_validation_sender_email, ''),
  nullif(email_from_address, ''),
  'no-reply@washingtonlopes.com'
)
where lower(coalesce(email_smtp_host, '')) like '%resend%'
  and lower(split_part(coalesce(email_change_sender_email, ''), '@', 2)) in (
    'gmail.com',
    'googlemail.com',
    'hotmail.com',
    'live.com',
    'outlook.com',
    'yahoo.com'
  );
