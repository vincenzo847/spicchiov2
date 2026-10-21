-- =====================================================================
-- Nome e logo della pizzeria
-- Da eseguire dopo supabase-sicurezza.sql. Si può rieseguire.
--
-- Ogni pizzeria ha un logo (facoltativo), mostrato nell'app dopo l'accesso.
-- I loghi stanno nello spazio file pubblico "loghi": chiunque abbia il
-- link può vederli (sono immagini pubbliche, come su un'insegna).
-- Nome e logo li cambia solo il titolare, dall'app (Impostazioni › Pizzeria),
-- oppure tu con il blocco in fondo a questo file.
-- =====================================================================
alter table public.ristoranti add column if not exists logo_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('loghi', 'loghi', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- il titolare carica il logo nella cartella con l'id della sua pizzeria
-- (la lettura serve per sostituire un file; per vedere il logo basta il link pubblico)
drop policy if exists loghi_titolare_lettura on storage.objects;
create policy loghi_titolare_lettura on storage.objects for select to authenticated
  using (bucket_id = 'loghi' and (storage.foldername(name))[1] in (select r::text from public.miei_ristoranti_titolare() r));
drop policy if exists loghi_titolare_carica on storage.objects;
create policy loghi_titolare_carica on storage.objects for insert to authenticated
  with check (bucket_id = 'loghi' and (storage.foldername(name))[1] in (select r::text from public.miei_ristoranti_titolare() r));
drop policy if exists loghi_titolare_modifica on storage.objects;
create policy loghi_titolare_modifica on storage.objects for update to authenticated
  using (bucket_id = 'loghi' and (storage.foldername(name))[1] in (select r::text from public.miei_ristoranti_titolare() r))
  with check (bucket_id = 'loghi' and (storage.foldername(name))[1] in (select r::text from public.miei_ristoranti_titolare() r));
drop policy if exists loghi_titolare_cancella on storage.objects;
create policy loghi_titolare_cancella on storage.objects for delete to authenticated
  using (bucket_id = 'loghi' and (storage.foldername(name))[1] in (select r::text from public.miei_ristoranti_titolare() r));

-- nome e logo: solo il titolare, e il logo solo dallo spazio "loghi" di Supabase
create or replace function public.aggiorna_pizzeria(p_rid uuid, p_nome text, p_logo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_rid is null or p_rid not in (select public.miei_ristoranti_titolare()) then
    raise exception 'Solo il titolare può cambiare nome e logo della pizzeria' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_nome, ''))) not between 1 and 80 then
    raise exception 'Scrivi il nome della pizzeria (al massimo 80 caratteri)' using errcode = '22023';
  end if;
  if p_logo is not null and p_logo !~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/loghi/[A-Za-z0-9._/%-]+$' then
    raise exception 'Il logo deve essere un file dello spazio "loghi" di Supabase' using errcode = '22023';
  end if;
  update public.ristoranti set nome = trim(p_nome), logo_url = p_logo where id = p_rid;
end $$;
revoke all on function public.aggiorna_pizzeria(uuid, text, text) from public, anon;
grant execute on function public.aggiorna_pizzeria(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Logo di una pizzeria, messo da te (facoltativo)
-- 1. Storage › loghi › Upload file: carica il logo (PNG o JPG, meno di 1 MB).
-- 2. Sul file appena caricato: Get URL, e copia il link.
-- 3. Incolla nome della pizzeria e link qui sotto ed esegui.
-- ---------------------------------------------------------------------
do $$
declare
  v_nome_pizzeria text := 'Nome della pizzeria';   -- <<< da compilare
  v_logo_url      text := 'https://...';           -- <<< da compilare
  v_n int;
begin
  if trim(v_nome_pizzeria) in ('', 'Nome della pizzeria') or v_logo_url = 'https://...' then
    raise notice 'Blocco del logo non compilato: saltato';
    return;
  end if;
  if v_logo_url !~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/loghi/[A-Za-z0-9._/%-]+$' then
    raise exception 'Il link deve essere quello di un file dello spazio "loghi" (Storage › loghi › Get URL)';
  end if;
  update public.ristoranti set logo_url = trim(v_logo_url) where lower(nome) = lower(trim(v_nome_pizzeria));
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Nessuna pizzeria si chiama "%"', trim(v_nome_pizzeria); end if;
  raise notice 'Logo di "%" aggiornato', trim(v_nome_pizzeria);
end $$;

select nome, logo_url from public.ristoranti order by nome;
