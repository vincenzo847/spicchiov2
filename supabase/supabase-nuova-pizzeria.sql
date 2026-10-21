-- =====================================================================
-- Nuova pizzeria cliente
-- Prima: crea l'utente del titolare in Authentication › Users (Add user,
-- spunta "Auto Confirm User"). Poi compila le due righe qui sotto ed esegui.
-- Le causali scarto predefinite vengono create in automatico.
-- Logo (facoltativo): caricalo in Storage › loghi, copia il link con Get URL
-- e incollalo in v_logo_url (serve supabase-pizzeria.sql già eseguito).
-- =====================================================================
do $$
declare
  v_nome_pizzeria  text := 'Nome della pizzeria';        -- <<< da compilare
  v_email_titolare text := 'titolare@esempio.it';        -- <<< da compilare
  v_logo_url       text := '';                           -- facoltativo
  v_uid uuid;
  v_rid uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(trim(v_email_titolare));
  if v_uid is null then
    raise exception 'Crea prima l''utente in Authentication › Users';
  end if;

  if trim(v_nome_pizzeria) in ('', 'Nome della pizzeria') then
    raise exception 'Scrivi il nome della pizzeria alla riga v_nome_pizzeria';
  end if;
  -- due pizzerie con lo stesso nome si confondono: aggiungi la città
  if exists (select 1 from public.ristoranti where lower(nome) = lower(trim(v_nome_pizzeria))) then
    raise exception 'Esiste già una pizzeria "%": aggiungi la città al nome, per esempio "% · Napoli"', trim(v_nome_pizzeria), trim(v_nome_pizzeria);
  end if;

  insert into public.ristoranti (nome) values (trim(v_nome_pizzeria)) returning id into v_rid;

  if trim(v_logo_url) <> '' then
    if v_logo_url !~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/loghi/[A-Za-z0-9._/%-]+$' then
      raise exception 'Il link del logo deve essere quello di un file dello spazio "loghi" (Storage › loghi › Get URL)';
    end if;
    execute 'update public.ristoranti set logo_url = $1 where id = $2' using trim(v_logo_url), v_rid;
  end if;

  insert into public.membri (user_id, ristorante_id, ruolo)
  values (v_uid, v_rid, 'titolare')
  on conflict (user_id, ristorante_id) do update set ruolo = 'titolare';

  raise notice 'Pizzeria "%" creata con id %', v_nome_pizzeria, v_rid;
end $$;

-- Controllo
select r.id, r.nome, r.creato_il, u.email as titolare
from public.ristoranti r
join public.membri m on m.ristorante_id = r.id and m.ruolo = 'titolare'
join auth.users u on u.id = m.user_id
order by r.creato_il desc;

-- Per aggiungere o rimuovere un dipendente usa supabase-dipendenti.sql:
-- si collega alla pizzeria con il suo id, non con il nome.
