-- =====================================================================
-- Dipendenti di una pizzeria
-- 1. Esegui solo la query "Elenco" (selezionala ed esegui) e copia l'id
--    della pizzeria giusta.
-- 2. Compila le tre righe qui sotto ed esegui tutto lo script.
-- La pizzeria si indica con l'id e non con il nome: due pizzerie con lo
-- stesso nome non si possono confondere.
-- =====================================================================

-- Elenco: pizzerie con id, titolare e dipendenti
select r.id, r.nome, m.ruolo, u.email
from public.ristoranti r
left join public.membri m on m.ristorante_id = r.id
left join auth.users u on u.id = m.user_id
order by r.nome, m.ruolo desc, u.email;

do $$
declare
  v_azione      text := 'aggiungi';                               -- <<< 'aggiungi' oppure 'rimuovi'
  v_ristorante  text := '00000000-0000-0000-0000-000000000000';   -- <<< id della pizzeria (dall'elenco)
  v_email       text := 'dipendente@esempio.it';                  -- <<< email del dipendente
  v_rid uuid;
  v_uid uuid;
  v_nome text;
  n integer;
begin
  begin
    v_rid := trim(v_ristorante)::uuid;
  exception when invalid_text_representation then
    raise exception 'v_ristorante non è un id valido: copialo dall''elenco';
  end;
  select nome into v_nome from public.ristoranti where id = v_rid;
  if v_nome is null then
    raise exception 'Nessuna pizzeria con id %: copialo dall''elenco', v_rid;
  end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(v_email));
  if v_uid is null then
    raise exception 'Utente "%" non trovato: crealo prima in Authentication › Users', trim(v_email);
  end if;

  if v_azione = 'aggiungi' then
    if exists (select 1 from public.membri where user_id = v_uid and ristorante_id = v_rid and ruolo = 'titolare') then
      raise exception '"%" è il titolare di "%": non lo trasformo in staff', trim(v_email), v_nome;
    end if;
    insert into public.membri (user_id, ristorante_id, ruolo) values (v_uid, v_rid, 'staff')
    on conflict (user_id, ristorante_id) do nothing;
    raise notice '"%" è staff di "%"', trim(v_email), v_nome;
  elsif v_azione = 'rimuovi' then
    -- l'accesso ai dati si chiude subito, anche sui dispositivi dove è ancora collegato
    delete from public.membri where user_id = v_uid and ristorante_id = v_rid and ruolo = 'staff';
    get diagnostics n = row_count;
    if n = 0 then raise exception '"%" non è staff di "%"', trim(v_email), v_nome; end if;
    raise notice '"%" rimosso da "%". Elimina l''utente anche in Authentication › Users se non lavora in altre pizzerie.', trim(v_email), v_nome;
  else
    raise exception 'v_azione deve essere ''aggiungi'' oppure ''rimuovi''';
  end if;
end $$;
