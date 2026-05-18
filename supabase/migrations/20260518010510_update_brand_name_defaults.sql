alter table public.site_settings
  alter column email_sender_name set default 'Kevin Willian Advogado',
  alter column email_from_name set default 'Kevin Willian Advogado';

update public.site_settings
set
  email_sender_name = 'Kevin Willian Advogado',
  email_from_name = 'Kevin Willian Advogado',
  updated_at = now()
where email_sender_name = 'KW Advocacia'
  or email_from_name = 'KW Advocacia';
