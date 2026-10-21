-- =====================================================================
-- salvataggio da più dispositivi (Supabase)
-- Richiede che supabase-sicurezza.sql sia già stato eseguito.
-- SQL Editor › New query › incolla tutto › Run. Si può rieseguire senza doppioni.
-- L'ultima tabella mostrata è il riepilogo della migrazione.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Funzioni di servizio
-- ---------------------------------------------------------------------
-- id stabile ricavato da un testo (lo stesso calcolo è fatto dall'app: niente doppioni se si rimigra)
create or replace function public.uuid_da(p text) returns uuid language sql immutable as $$
  select (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid
  from (select encode(sha256(convert_to(p, 'UTF8')), 'hex') as h) x;
$$;

create or replace function public.num_o_null(t text) returns numeric language sql immutable as $$
  select case when replace(trim(coalesce(t, '')), ',', '.') ~ '^-?[0-9]+(\.[0-9]+)?$'
              then replace(trim(t), ',', '.')::numeric end;
$$;

-- ---------------------------------------------------------------------
-- 2. Nuove tabelle (una riga per record)
-- ---------------------------------------------------------------------
create table if not exists public.causali (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  modalita text not null check (modalita in ('ingrediente', 'pizza', 'panetto')),
  nome text not null check (char_length(nome) between 1 and 30),
  personalizzata boolean not null default false,
  nascosta boolean not null default false,
  ordine integer not null default 0,
  creato_il timestamptz not null default now()
);
create index if not exists causali_rist_idx on public.causali (ristorante_id, modalita, ordine);

create table if not exists public.scarti (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  creato_da uuid default auth.uid() references auth.users(id) on delete set null,
  data date not null,
  turno text,
  tipo text not null check (tipo in ('ingrediente', 'pizza', 'panetto')),
  riferimento_id text not null,            -- id ingrediente, id pizza o 'dough'
  quantita numeric not null,               -- kg per gli ingredienti, pezzi per pizze e panetti
  unita text not null check (unita in ('kg', 'pz')),
  causale_id uuid references public.causali(id) on delete set null,
  causale_nome text,                       -- nome al momento della registrazione (riserva)
  costo_unitario numeric,                  -- €/kg o €/pezzo, all'ultimo acquisto entro la data
  costo_totale numeric,
  dettaglio jsonb not null default '{}',   -- grammi e pezzi esatti, o ingredienti di pizza/panetti
  client_id uuid not null unique,          -- generato sul dispositivo: blocca i doppi invii
  creato_il timestamptz not null default now()
);
create index if not exists scarti_rist_data_idx on public.scarti (ristorante_id, data);

create table if not exists public.storico_prezzi (
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  id text not null,
  ingrediente_id text not null,            -- id ingrediente (o articolo non alimentare)
  fornitore text,
  prezzo numeric not null,                 -- €/kg per gli ingredienti; €/unità per gli altri articoli
  data date not null,
  documento_id text,
  fonte text,
  extra jsonb not null default '{}',
  creato_il timestamptz not null default now(),
  primary key (ristorante_id, id)
);
create index if not exists storico_prezzi_ing_idx on public.storico_prezzi (ristorante_id, ingrediente_id, data);

create table if not exists public.incassi (
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  tipo text not null check (tipo in ('settimana', 'mese', 'anno')),
  inizio date not null,                    -- lunedì della settimana, primo del mese, 1 gennaio
  incasso_totale numeric,                  -- incasso totale senza IVA
  pct_costo_altre numeric,                 -- % costo merce delle altre vendite
  aggiornato_il timestamptz not null default now(),
  primary key (ristorante_id, tipo, inizio)
);

-- ---------------------------------------------------------------------
-- 3. Versione sulla tabella "dati" (ingredienti, ricette, impostazioni, spese fisse…)
-- ---------------------------------------------------------------------
alter table public.dati add column if not exists versione integer not null default 1;

create or replace function public.dati_controlla_versione() returns trigger language plpgsql as $$
begin
  if new.versione is distinct from old.versione + 1 then
    raise exception 'conflitto_versione' using errcode = '40001';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists dati_versione on public.dati;
create trigger dati_versione before update on public.dati
  for each row execute function public.dati_controlla_versione();

-- ---------------------------------------------------------------------
-- 4. Causali predefinite (anche per ogni nuova pizzeria)
-- ---------------------------------------------------------------------
create or replace function public.semina_causali(p uuid) returns void language sql as $$
  insert into public.causali (id, ristorante_id, modalita, nome, ordine)
  select public.uuid_da(p::text || ':causale:' || d.m || ':' || lower(d.nome)), p, d.modalita, d.nome, d.ordine
  from (values
    ('ing', 'ingrediente', 'Scaduto', 0), ('ing', 'ingrediente', 'Andato a male', 1), ('ing', 'ingrediente', 'Avanzo a fine serata', 2),
    ('ing', 'ingrediente', 'Errore ordine', 3), ('ing', 'ingrediente', 'Caduto / contaminato', 4), ('ing', 'ingrediente', 'Reso cliente', 5),
    ('pizza', 'pizza', 'Bruciata', 0), ('pizza', 'pizza', 'Reso cliente', 1), ('pizza', 'pizza', 'Errore comanda', 2), ('pizza', 'pizza', 'Caduta', 3),
    ('dough', 'panetto', 'Impasto non lievitato', 0), ('dough', 'panetto', 'Impasto rovinato', 1), ('dough', 'panetto', 'Avanzo a fine serata', 2)
  ) as d(m, modalita, nome, ordine)
  where not exists (select 1 from public.causali c where c.ristorante_id = p and c.modalita = d.modalita)
  on conflict (id) do nothing;
$$;

create or replace function public.ristorante_nuovo() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.semina_causali(new.id); return new; end $$;
drop trigger if exists ristoranti_semina on public.ristoranti;
create trigger ristoranti_semina after insert on public.ristoranti
  for each row execute function public.ristorante_nuovo();

-- ---------------------------------------------------------------------
-- 5. Migrazione dalla tabella "dati"
-- ---------------------------------------------------------------------
-- 5a. causali (liste salvate, comprese quelle personalizzate, rinominate o nascoste)
insert into public.causali (id, ristorante_id, modalita, nome, personalizzata, nascosta, ordine)
select public.uuid_da(d.ristorante_id::text || ':causale:' || m.key || ':' || lower(e.v->>'label')),
       d.ristorante_id,
       case m.key when 'ing' then 'ingrediente' when 'pizza' then 'pizza' else 'panetto' end,
       left(e.v->>'label', 30),
       coalesce((e.v->>'custom')::boolean, false),
       coalesce((e.v->>'hidden')::boolean, false),
       (e.n - 1)::int
from public.dati d
cross join lateral jsonb_each(d.valore) m
cross join lateral jsonb_array_elements(m.value) with ordinality e(v, n)
where d.chiave = 'wasteReasons' and jsonb_typeof(d.valore) = 'object' and jsonb_typeof(m.value) = 'array'
  and m.key in ('ing', 'pizza', 'dough') and coalesce(trim(e.v->>'label'), '') <> ''
on conflict (id) do nothing;

-- causali predefinite per le modalità mai personalizzate
select public.semina_causali(id) from public.ristoranti;

-- 5b. scarti
insert into public.scarti (ristorante_id, creato_da, data, turno, tipo, riferimento_id, quantita, unita,
                           causale_id, causale_nome, dettaglio, client_id)
select d.ristorante_id,
       (select mb.user_id from public.membri mb where mb.ristorante_id = d.ristorante_id and mb.ruolo = 'titolare' limit 1),
       (e.w->>'date')::date,
       e.w->>'shift',
       t.tipo,
       case when t.tipo = 'ingrediente' then e.w->>'ing' else coalesce(e.w->>'ref', 'dough') end,
       case when t.tipo = 'ingrediente' then public.num_o_null(e.w->>'qty') / 1000 else coalesce(public.num_o_null(e.w->>'n'), 1) end,
       case when t.tipo = 'ingrediente' then 'kg' else 'pz' end,
       (select c.id from public.causali c where c.ristorante_id = d.ristorante_id and c.modalita = t.tipo
          and lower(c.nome) = lower(e.w->>'reason') order by c.ordine limit 1),
       e.w->>'reason',
       case when t.tipo = 'ingrediente'
            then jsonb_strip_nulls(jsonb_build_object('g', public.num_o_null(e.w->>'qty'), 'pcs', e.w->'pcs'))
            else jsonb_build_object('items', coalesce(e.w->'items', '[]'::jsonb)) end,
       case when e.w->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (e.w->>'id')::uuid
            else public.uuid_da(d.ristorante_id::text || ':' || coalesce(e.w->>'id', 'n' || e.n)) end
from public.dati d
cross join lateral jsonb_array_elements(d.valore) with ordinality e(w, n)
cross join lateral (select case coalesce(e.w->>'kind', 'ing') when 'pizza' then 'pizza' when 'dough' then 'panetto' else 'ingrediente' end as tipo) t
where d.chiave = 'waste' and jsonb_typeof(d.valore) = 'array'
  and e.w->>'date' ~ '^\d{4}-\d{2}-\d{2}$'
  and (t.tipo <> 'ingrediente' or (e.w->>'ing' is not null and public.num_o_null(e.w->>'qty') is not null))
on conflict (client_id) do nothing;

-- 5c. storico prezzi
insert into public.storico_prezzi (ristorante_id, id, ingrediente_id, fornitore, prezzo, data, documento_id, fonte, extra)
select d.ristorante_id,
       coalesce(e.l->>'id', 'mig-' || e.n),
       e.l->>'ing',
       e.l->>'sup',
       public.num_o_null(e.l->>'price'),
       (e.l->>'date')::date,
       e.l->>'doc',
       e.l->>'src',
       e.l - array['id', 'ing', 'sup', 'price', 'date', 'doc', 'src']
from public.dati d
cross join lateral jsonb_array_elements(d.valore) with ordinality e(l, n)
where d.chiave = 'priceLog' and jsonb_typeof(d.valore) = 'array'
  and e.l->>'ing' is not null and e.l->>'date' ~ '^\d{4}-\d{2}-\d{2}$' and public.num_o_null(e.l->>'price') is not null
on conflict (ristorante_id, id) do nothing;

-- 5d. incassi
insert into public.incassi (ristorante_id, tipo, inizio, incasso_totale, pct_costo_altre)
select d.ristorante_id,
       case p.key when 'w' then 'settimana' when 'm' then 'mese' else 'anno' end,
       case p.key when 'w' then date_trunc('week', now() at time zone 'Europe/Rome')::date
                  when 'm' then date_trunc('month', now() at time zone 'Europe/Rome')::date
                  else date_trunc('year', now() at time zone 'Europe/Rome')::date end,
       public.num_o_null(p.value->>'tot'), public.num_o_null(p.value->>'pct')
from public.dati d
cross join lateral jsonb_each(d.valore) p
where d.chiave = 'income' and jsonb_typeof(d.valore) = 'object' and jsonb_typeof(p.value) = 'object' and p.key in ('w', 'm', 'y')
  and (public.num_o_null(p.value->>'tot') is not null or public.num_o_null(p.value->>'pct') is not null)
on conflict (ristorante_id, tipo, inizio) do nothing;

-- ---------------------------------------------------------------------
-- 6. Regole RLS (stesso schema del passo sicurezza)
-- ---------------------------------------------------------------------
alter table public.causali enable row level security;
alter table public.scarti enable row level security;
alter table public.storico_prezzi enable row level security;
alter table public.incassi enable row level security;

-- dati: ora scrive solo il titolare (gli scarti hanno la loro tabella)
drop policy if exists dati_staff_scarti_inserisce on public.dati;
drop policy if exists dati_staff_scarti_modifica on public.dati;

-- causali: tutti i membri leggono, solo il titolare modifica
drop policy if exists causali_lettura on public.causali;
create policy causali_lettura on public.causali for select to authenticated
  using (ristorante_id in (select public.miei_ristoranti()));
drop policy if exists causali_titolare_inserisce on public.causali;
create policy causali_titolare_inserisce on public.causali for insert to authenticated
  with check (ristorante_id in (select public.miei_ristoranti_titolare()));
drop policy if exists causali_titolare_modifica on public.causali;
create policy causali_titolare_modifica on public.causali for update to authenticated
  using (ristorante_id in (select public.miei_ristoranti_titolare()))
  with check (ristorante_id in (select public.miei_ristoranti_titolare()));
drop policy if exists causali_titolare_cancella on public.causali;
create policy causali_titolare_cancella on public.causali for delete to authenticated
  using (ristorante_id in (select public.miei_ristoranti_titolare()));

-- scarti: tutti i membri leggono e registrano a proprio nome; il titolare corregge;
-- il titolare cancella tutto, lo staff solo i propri delle ultime 48 ore
drop policy if exists scarti_lettura on public.scarti;
create policy scarti_lettura on public.scarti for select to authenticated
  using (ristorante_id in (select public.miei_ristoranti()));
drop policy if exists scarti_inserisce on public.scarti;
create policy scarti_inserisce on public.scarti for insert to authenticated
  with check (ristorante_id in (select public.miei_ristoranti()) and creato_da = auth.uid());
drop policy if exists scarti_titolare_modifica on public.scarti;
create policy scarti_titolare_modifica on public.scarti for update to authenticated
  using (ristorante_id in (select public.miei_ristoranti_titolare()))
  with check (ristorante_id in (select public.miei_ristoranti_titolare()));
drop policy if exists scarti_cancella on public.scarti;
create policy scarti_cancella on public.scarti for delete to authenticated
  using (ristorante_id in (select public.miei_ristoranti_titolare())
         or (ristorante_id in (select public.miei_ristoranti()) and creato_da = auth.uid() and creato_il > now() - interval '48 hours'));

-- storico_prezzi: tutti i membri leggono (serve per il costo degli scarti), solo il titolare modifica
drop policy if exists prezzi_lettura on public.storico_prezzi;
create policy prezzi_lettura on public.storico_prezzi for select to authenticated
  using (ristorante_id in (select public.miei_ristoranti()));
drop policy if exists prezzi_titolare_inserisce on public.storico_prezzi;
create policy prezzi_titolare_inserisce on public.storico_prezzi for insert to authenticated
  with check (ristorante_id in (select public.miei_ristoranti_titolare()));
drop policy if exists prezzi_titolare_modifica on public.storico_prezzi;
create policy prezzi_titolare_modifica on public.storico_prezzi for update to authenticated
  using (ristorante_id in (select public.miei_ristoranti_titolare()))
  with check (ristorante_id in (select public.miei_ristoranti_titolare()));
drop policy if exists prezzi_titolare_cancella on public.storico_prezzi;
create policy prezzi_titolare_cancella on public.storico_prezzi for delete to authenticated
  using (ristorante_id in (select public.miei_ristoranti_titolare()));

-- incassi: solo il titolare (lo staff non li vede)
drop policy if exists incassi_titolare_lettura on public.incassi;
create policy incassi_titolare_lettura on public.incassi for select to authenticated
  using (ristorante_id in (select public.miei_ristoranti_titolare()));
drop policy if exists incassi_titolare_inserisce on public.incassi;
create policy incassi_titolare_inserisce on public.incassi for insert to authenticated
  with check (ristorante_id in (select public.miei_ristoranti_titolare()));
drop policy if exists incassi_titolare_modifica on public.incassi;
create policy incassi_titolare_modifica on public.incassi for update to authenticated
  using (ristorante_id in (select public.miei_ristoranti_titolare()))
  with check (ristorante_id in (select public.miei_ristoranti_titolare()));
drop policy if exists incassi_titolare_cancella on public.incassi;
create policy incassi_titolare_cancella on public.incassi for delete to authenticated
  using (ristorante_id in (select public.miei_ristoranti_titolare()));

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 7. Riepilogo della migrazione
-- ---------------------------------------------------------------------
select voce, nella_vecchia_tabella_dati, nella_nuova_tabella, nota from (
  select 1 o, 'scarti' voce,
    (select coalesce(sum(jsonb_array_length(valore)), 0) from public.dati where chiave = 'waste' and jsonb_typeof(valore) = 'array')::text nella_vecchia_tabella_dati,
    (select count(*) from public.scarti)::text nella_nuova_tabella,
    (select count(*) from public.scarti where causale_id is null)::text || ' senza causale collegata (resta il nome)' nota
  union all select 2, 'storico_prezzi',
    (select coalesce(sum(jsonb_array_length(valore)), 0) from public.dati where chiave = 'priceLog' and jsonb_typeof(valore) = 'array')::text,
    (select count(*) from public.storico_prezzi)::text, ''
  union all select 3, 'causali',
    (select count(*) from public.dati d cross join lateral jsonb_each(d.valore) m cross join lateral jsonb_array_elements(m.value) e
       where d.chiave = 'wasteReasons' and jsonb_typeof(d.valore) = 'object' and jsonb_typeof(m.value) = 'array')::text,
    (select count(*) from public.causali)::text, 'comprese le predefinite create ora'
  union all select 4, 'incassi',
    (select count(*) from public.dati d cross join lateral jsonb_each(d.valore) p where d.chiave = 'income' and jsonb_typeof(d.valore) = 'object')::text,
    (select count(*) from public.incassi)::text, 'i periodi vuoti non vengono copiati'
  union all select 5, 'dati · ' || chiave, count(*)::text, '',
    case when chiave in ('waste', 'priceLog', 'wasteReasons', 'income') then 'copia di riserva: già migrata, l''app non la usa più'
         when chiave in ('ingredients', 'pizzas', 'fixed', 'suppliers', 'articles', 'settings') then 'resta qui, con versione'
         else 'NON MIGRATA: da controllare' end
  from public.dati group by chiave
) r order by o, voce;

-- Quando hai verificato che l'app nuova funziona, puoi togliere le copie di riserva:
--   delete from public.dati where chiave in ('waste', 'priceLog', 'wasteReasons', 'income');
