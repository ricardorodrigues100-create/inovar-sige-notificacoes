create table if not exists inovar_events (
  id bigint primary key,
  data timestamptz not null,
  local text,
  tipo integer,
  ponto_acesso text,
  motivo text,
  permitido integer,
  obs text,
  notified_at timestamptz default now()
);

-- Índice para consultares rapidamente os últimos eventos na Supabase, se quiseres
create index if not exists inovar_events_data_idx on inovar_events (data desc);

-- Guarda o cookie de sessão para ser reutilizado entre verificações,
-- evitando fazer login repetidamente (o que poderia levar a um bloqueio da conta).
create table if not exists inovar_session (
  id integer primary key,
  cookie text not null,
  updated_at timestamptz default now()
);
