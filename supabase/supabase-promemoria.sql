-- =====================================================================
-- Promemoria a fine servizio (notifiche sul telefono)
-- Da eseguire dopo supabase-sicurezza.sql. Si può rieseguire.
--
-- Una riga per dispositivo che ha attivato il promemoria. Ogni persona
-- vede e gestisce solo i propri dispositivi; la funzione serale
-- /api/promemoria le legge con la chiave del server.
-- =====================================================================
create table if not exists public.promemoria (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  creato_il timestamptz not null default now()
);
create index if not exists promemoria_rist_idx on public.promemoria (ristorante_id);

alter table public.promemoria enable row level security;

drop policy if exists promemoria_lettura on public.promemoria;
create policy promemoria_lettura on public.promemoria for select to authenticated
  using (user_id = auth.uid());
drop policy if exists promemoria_inserisce on public.promemoria;
create policy promemoria_inserisce on public.promemoria for insert to authenticated
  with check (user_id = auth.uid() and ristorante_id in (select public.miei_ristoranti()));
drop policy if exists promemoria_modifica on public.promemoria;
create policy promemoria_modifica on public.promemoria for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and ristorante_id in (select public.miei_ristoranti()));
drop policy if exists promemoria_cancella on public.promemoria;
create policy promemoria_cancella on public.promemoria for delete to authenticated
  using (user_id = auth.uid());

notify pgrst, 'reload schema';
