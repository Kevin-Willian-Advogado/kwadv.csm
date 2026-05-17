create table if not exists public.site_settings (
  id smallint primary key default 1 check (id = 1),
  articles_enabled boolean not null default true,
  contact_phone_whatsapp character varying(40) not null default '',
  contact_email character varying(180) not null default '',
  instagram_url character varying(300) not null default '',
  linkedin_url character varying(300) not null default '',
  email_sender_name character varying(120) not null default '',
  email_sender_address character varying(180) not null default '',
  contact_confirmation_subject character varying(180) not null default '',
  contact_confirmation_body text not null default '',
  contact_notification_recipients text[] not null default array[]::text[],
  contact_notification_subject character varying(180) not null default '',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  updated_by integer
);

insert into public.site_settings (
  id,
  articles_enabled,
  contact_confirmation_subject,
  contact_confirmation_body,
  contact_notification_subject
)
values (
  1,
  true,
  'Recebemos sua mensagem',
  'Obrigado pelo contato. Em breve retornaremos.',
  'Novo contato recebido pelo site'
)
on conflict (id) do nothing;

alter table public.site_settings enable row level security;
