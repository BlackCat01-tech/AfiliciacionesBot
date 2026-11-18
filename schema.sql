-- Ejecutar una vez en Supabase: SQL Editor -> New query -> Run
create table if not exists afiliaciones (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists conversaciones (
  canal text not null,
  chat_id text not null,
  estado jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (canal, chat_id)
);
-- Bloquea el acceso por la API pública de Supabase; el servidor entra con su cadena de conexión.
alter table afiliaciones enable row level security;
alter table conversaciones enable row level security;
