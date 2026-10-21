-- =====================================================================
-- Vendite importate dalla cassa
-- Da eseguire dopo supabase-multidispositivo.sql. Si può rieseguire.
--
-- Una riga per giorno e pizza. Per ogni giorno importato c'è anche la
-- riga pizza_id = '__giorno' con quantità 0: dice che quel giorno è
-- coperto dalla cassa (anche se chiuso), così non viene stimato.
-- Solo il titolare le legge, le importa o le cancella.
-- =====================================================================
create table if not exists public.vendite (
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  data date not null,
  pizza_id text not null,
  quantita numeric not null check (quantita >= 0),
  importato_il timestamptz not null default now(),
  primary key (ristorante_id, data, pizza_id)
);

alter table public.vendite enable row level security;

drop policy if exists vendite_lettura on public.vendite;
create policy vendite_lettura on public.vendite for select to authenticated
  using (ristorante_id in (select public.miei_ristoranti_titolare()));
drop policy if exists vendite_titolare_inserisce on public.vendite;
create policy vendite_titolare_inserisce on public.vendite for insert to authenticated
  with check (ristorante_id in (select public.miei_ristoranti_titolare()));
drop policy if exists vendite_titolare_modifica on public.vendite;
create policy vendite_titolare_modifica on public.vendite for update to authenticated
  using (ristorante_id in (select public.miei_ristoranti_titolare()))
  with check (ristorante_id in (select public.miei_ristoranti_titolare()));
drop policy if exists vendite_titolare_cancella on public.vendite;
create policy vendite_titolare_cancella on public.vendite for delete to authenticated
  using (ristorante_id in (select public.miei_ristoranti_titolare()));

notify pgrst, 'reload schema';
