-- =====================================================================
-- Candidature alla prova di Spicchio (modulo "Partecipa alla prova" del login)
-- Da eseguire dopo supabase-sicurezza.sql. Si può rieseguire.
--
-- Le risposte le scrive solo la funzione del server /api/candidatura con la
-- chiave service_role. La tabella ha la sicurezza per riga attiva e NESSUNA
-- regola: dall'app (anon o utenti collegati) non si legge né si scrive.
-- Le candidature si guardano da Supabase › Table Editor › candidature.
-- =====================================================================
create table if not exists public.candidature (
  id uuid primary key default gen_random_uuid(),
  creato_il timestamptz not null default now(),
  email text not null,
  pizzeria text not null,
  dati jsonb not null default '{}',      -- risposte del modulo
  consensi jsonb not null default '{}',  -- data e ora di ogni consenso dato, e versione dei testi
  ip_hash text,                          -- impronta dell'indirizzo, solo per limitare gli invii ripetuti
  user_agent text,
  stato text not null default 'nuova' check (stato in ('nuova', 'approvata', 'scartata')),
  note text
);
create index if not exists candidature_creato_idx on public.candidature (creato_il desc);
create index if not exists candidature_ip_idx on public.candidature (ip_hash, creato_il);

alter table public.candidature enable row level security;
revoke all on public.candidature from anon, authenticated;

-- Controllo: deve restituire 0 righe (nessuna regola sulla tabella)
select policyname from pg_policies where schemaname = 'public' and tablename = 'candidature';
