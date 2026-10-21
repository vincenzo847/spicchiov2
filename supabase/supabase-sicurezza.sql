-- =====================================================================
-- sicurezza multi-pizzeria (Supabase)
-- Da eseguire UNA volta in SQL Editor › New query › Run.
-- Prima di eseguire: scrivi la tua email alla riga "v_email" (sezione 2).
-- Si può rieseguire senza danni.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tabelle di base
-- ---------------------------------------------------------------------
create extension if not exists pgcrypto;

create table if not exists public.ristoranti (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  creato_il timestamptz not null default now()
);

create table if not exists public.membri (
  user_id uuid not null references auth.users(id) on delete cascade,
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  ruolo text not null check (ruolo in ('titolare', 'staff')),
  primary key (user_id, ristorante_id)
);
create index if not exists membri_user_id_idx on public.membri(user_id);

create table if not exists public.uso_ai (
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  giorno date not null,
  conteggio integer not null default 0,
  primary key (ristorante_id, giorno)
);

-- tabelle dati già esistenti (create da supabase-setup.sql)
create table if not exists public.dati (chiave text not null, valore jsonb not null, updated_at timestamptz default now());
create table if not exists public.documenti (id text not null, data jsonb not null, updated_at timestamptz default now());

-- ---------------------------------------------------------------------
-- 2. Prima pizzeria e titolare
-- (l'id fisso serve a collegare i dati della prima versione dell'app; per le altre pizzerie usa supabase-nuova-pizzeria.sql)
-- ---------------------------------------------------------------------
do $$
declare
  v_email text := 'LA-TUA-EMAIL@esempio.it';   -- <<< SCRIVI QUI LA TUA EMAIL DI ACCESSO
  v_nome  text := 'Nome della pizzeria';       -- <<< NOME DELLA PRIMA PIZZERIA (ignorato se esiste già)
  v_rid uuid := 'a7f1c3e2-5b1d-4c8e-9f2a-6d3b0e4c1a01';
  v_uid uuid;
begin
  if not exists (select 1 from public.ristoranti where id = v_rid) and trim(v_nome) in ('', 'Nome della pizzeria') then
    raise exception 'Scrivi il nome della prima pizzeria alla riga v_nome e riesegui.';
  end if;
  insert into public.ristoranti (id, nome) values (v_rid, trim(v_nome)) on conflict (id) do nothing;
  select id into v_uid from auth.users where lower(email) = lower(v_email);
  if v_uid is null then
    raise exception 'Utente "%" non trovato: scrivi la tua email alla riga v_email e riesegui.', v_email;
  end if;
  insert into public.membri (user_id, ristorante_id, ruolo) values (v_uid, v_rid, 'titolare')
  on conflict (user_id, ristorante_id) do update set ruolo = 'titolare';
end $$;

-- ---------------------------------------------------------------------
-- 3. ristorante_id su ogni tabella di dati + migrazione righe esistenti
-- ---------------------------------------------------------------------
alter table public.dati add column if not exists ristorante_id uuid references public.ristoranti(id) on delete cascade;
update public.dati set ristorante_id = 'a7f1c3e2-5b1d-4c8e-9f2a-6d3b0e4c1a01' where ristorante_id is null;
alter table public.dati alter column ristorante_id set not null;
alter table public.dati drop constraint if exists dati_pkey;
alter table public.dati add constraint dati_pkey primary key (ristorante_id, chiave);

alter table public.documenti add column if not exists ristorante_id uuid references public.ristoranti(id) on delete cascade;
update public.documenti set ristorante_id = 'a7f1c3e2-5b1d-4c8e-9f2a-6d3b0e4c1a01' where ristorante_id is null;
alter table public.documenti alter column ristorante_id set not null;
alter table public.documenti drop constraint if exists documenti_pkey;
alter table public.documenti add constraint documenti_pkey primary key (ristorante_id, id);

-- ---------------------------------------------------------------------
-- 4. Funzioni (security definer: evitano la ricorsione nelle regole)
-- ---------------------------------------------------------------------
create or replace function public.miei_ristoranti()
returns setof uuid language sql stable security definer set search_path = public as $$
  select ristorante_id from public.membri where user_id = auth.uid();
$$;

create or replace function public.miei_ristoranti_titolare()
returns setof uuid language sql stable security definer set search_path = public as $$
  select ristorante_id from public.membri where user_id = auth.uid() and ruolo = 'titolare';
$$;

-- conta una lettura AI; massimo 100 al giorno per ristorante (ora italiana)
create or replace function public.consuma_lettura_ai(p_ristorante uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  if not exists (select 1 from public.membri where user_id = auth.uid() and ristorante_id = p_ristorante) then
    raise exception 'non_membro' using errcode = '42501';
  end if;
  insert into public.uso_ai (ristorante_id, giorno, conteggio)
  values (p_ristorante, (now() at time zone 'Europe/Rome')::date, 1)
  on conflict (ristorante_id, giorno) do update set conteggio = public.uso_ai.conteggio + 1
  where public.uso_ai.conteggio < 100
  returning conteggio into v;
  if v is null then return jsonb_build_object('ok', false, 'conteggio', 100); end if;
  return jsonb_build_object('ok', true, 'conteggio', v);
end $$;

revoke all on function public.miei_ristoranti() from public, anon;
revoke all on function public.miei_ristoranti_titolare() from public, anon;
revoke all on function public.consuma_lettura_ai(uuid) from public, anon;
grant execute on function public.miei_ristoranti() to authenticated;
grant execute on function public.miei_ristoranti_titolare() to authenticated;
grant execute on function public.consuma_lettura_ai(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Regole RLS sulle tabelle
-- ---------------------------------------------------------------------
alter table public.ristoranti enable row level security;
alter table public.membri enable row level security;
alter table public.dati enable row level security;
alter table public.documenti enable row level security;
alter table public.uso_ai enable row level security;

-- via le vecchie regole "using (true)"
drop policy if exists "app documenti" on public.documenti;
drop policy if exists "utenti documenti" on public.documenti;
drop policy if exists "utenti dati" on public.dati;

-- ristoranti: si legge solo il proprio, nessuna scrittura dall'app
drop policy if exists ristoranti_lettura on public.ristoranti;
create policy ristoranti_lettura on public.ristoranti for select to authenticated
  using (id in (select public.miei_ristoranti()));

-- membri: ognuno legge solo le proprie righe; nessuna scrittura dall'app
drop policy if exists membri_lettura on public.membri;
create policy membri_lettura on public.membri for select to authenticated
  using (user_id = auth.uid());

-- dati: titolare tutto; lo staff legge solo ingredienti, ricette e impostazioni (servono per gli scarti)
drop policy if exists dati_lettura on public.dati;
create policy dati_lettura on public.dati for select to authenticated
  using (
    ristorante_id in (select public.miei_ristoranti_titolare())
    or (ristorante_id in (select public.miei_ristoranti()) and chiave in ('ingredients', 'pizzas', 'settings'))
  );

drop policy if exists dati_titolare_inserisce on public.dati;
create policy dati_titolare_inserisce on public.dati for insert to authenticated
  with check (ristorante_id in (select public.miei_ristoranti_titolare()));

drop policy if exists dati_titolare_modifica on public.dati;
create policy dati_titolare_modifica on public.dati for update to authenticated
  using (ristorante_id in (select public.miei_ristoranti_titolare()))
  with check (ristorante_id in (select public.miei_ristoranti_titolare()));

drop policy if exists dati_titolare_cancella on public.dati;
create policy dati_titolare_cancella on public.dati for delete to authenticated
  using (ristorante_id in (select public.miei_ristoranti_titolare()));

drop policy if exists dati_staff_scarti_inserisce on public.dati;
create policy dati_staff_scarti_inserisce on public.dati for insert to authenticated
  with check (ristorante_id in (select public.miei_ristoranti()) and chiave = 'waste');

drop policy if exists dati_staff_scarti_modifica on public.dati;
create policy dati_staff_scarti_modifica on public.dati for update to authenticated
  using (ristorante_id in (select public.miei_ristoranti()) and chiave = 'waste')
  with check (ristorante_id in (select public.miei_ristoranti()) and chiave = 'waste');

-- documenti: solo il titolare (lo staff si occupa solo degli scarti)
drop policy if exists documenti_lettura on public.documenti;
create policy documenti_lettura on public.documenti for select to authenticated
  using (ristorante_id in (select public.miei_ristoranti_titolare()));

drop policy if exists documenti_inserisce on public.documenti;
create policy documenti_inserisce on public.documenti for insert to authenticated
  with check (ristorante_id in (select public.miei_ristoranti_titolare()));

drop policy if exists documenti_modifica on public.documenti;
create policy documenti_modifica on public.documenti for update to authenticated
  using (ristorante_id in (select public.miei_ristoranti_titolare()))
  with check (ristorante_id in (select public.miei_ristoranti_titolare()));

drop policy if exists documenti_cancella on public.documenti;
create policy documenti_cancella on public.documenti for delete to authenticated
  using (ristorante_id in (select public.miei_ristoranti_titolare()));

-- uso_ai: il titolare può leggere il conteggio; si scrive solo tramite consuma_lettura_ai()
drop policy if exists uso_ai_lettura on public.uso_ai;
create policy uso_ai_lettura on public.uso_ai for select to authenticated
  using (ristorante_id in (select public.miei_ristoranti_titolare()));

-- ---------------------------------------------------------------------
-- 6. Spazio file "documenti": percorso {ristorante_id}/{fornitore}/{anno}/{mese}/file
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('documenti', 'documenti', false)
on conflict (id) do update set public = false;

drop policy if exists "app file" on storage.objects;
drop policy if exists "utenti file" on storage.objects;

drop policy if exists file_lettura on storage.objects;
create policy file_lettura on storage.objects for select to authenticated
  using (bucket_id = 'documenti' and (storage.foldername(name))[1] in (select r::text from public.miei_ristoranti_titolare() r));

drop policy if exists file_inserisce on storage.objects;
create policy file_inserisce on storage.objects for insert to authenticated
  with check (bucket_id = 'documenti' and (storage.foldername(name))[1] in (select r::text from public.miei_ristoranti_titolare() r));

drop policy if exists file_modifica on storage.objects;
create policy file_modifica on storage.objects for update to authenticated
  using (bucket_id = 'documenti' and (storage.foldername(name))[1] in (select r::text from public.miei_ristoranti_titolare() r))
  with check (bucket_id = 'documenti' and (storage.foldername(name))[1] in (select r::text from public.miei_ristoranti_titolare() r));

drop policy if exists file_cancella on storage.objects;
create policy file_cancella on storage.objects for delete to authenticated
  using (bucket_id = 'documenti' and (storage.foldername(name))[1] in (select r::text from public.miei_ristoranti_titolare() r));

-- ---------------------------------------------------------------------
-- 7. Controllo finale (deve restituire 0 righe)
-- ---------------------------------------------------------------------
select tablename, policyname from pg_policies
where schemaname in ('public', 'storage') and (qual = 'true' or with_check = 'true');

