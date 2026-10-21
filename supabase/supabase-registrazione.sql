-- =====================================================================
-- Registrazione dall'app: chi si iscrive da "Crea un account" diventa titolare di una pizzeria nuova.
-- Da eseguire dopo gli altri script (serve supabase-multidispositivo.sql per le causali). Si può rieseguire.
--
-- Come funziona:
-- 1. l'app crea l'account con Supabase Auth e salva il nome della pizzeria nei dati dell'utente ("pizzeria");
-- 2. il titolare conferma l'email dal link ricevuto;
-- 3. al primo accesso, se l'account non è ancora in nessuna pizzeria, l'app chiama crea_mia_pizzeria():
--    la pizzeria nasce con le causali scarto predefinite e l'account ne diventa titolare.
-- Un account crea una sola pizzeria: dopo la creazione il nome viene tolto dai dati dell'utente.
--
-- In Supabase, oltre a questo script:
-- - Authentication › Sign In / Providers: attiva "Allow new users to sign up" e lascia attivo "Confirm email";
-- - Authentication › URL Configuration: Site URL e Redirect URL = indirizzo dell'app (il link di conferma torna lì).
-- =====================================================================

-- da dove arriva la pizzeria: 'manuale' (supabase-nuova-pizzeria.sql) o 'registrazione' (dall'app)
alter table public.ristoranti add column if not exists origine text not null default 'manuale';

create or replace function public.crea_mia_pizzeria()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_nome text;
  v_base text;
  v_conf timestamptz;
  v_rid  uuid;
  n      int := 1;
begin
  if v_uid is null then raise exception 'non_autenticato'; end if;
  -- una richiesta alla volta per account: due schede aperte non creano due pizzerie
  perform pg_advisory_xact_lock(hashtext('crea_mia_pizzeria:' || v_uid::text));
  if exists (select 1 from public.membri where user_id = v_uid) then raise exception 'gia_membro'; end if;

  select left(btrim(regexp_replace(coalesce(raw_user_meta_data->>'pizzeria', ''), '\s+', ' ', 'g')), 80), email_confirmed_at
    into v_nome, v_conf
    from auth.users where id = v_uid;
  if v_conf is null then raise exception 'email_non_confermata'; end if;
  if coalesce(v_nome, '') = '' then raise exception 'nessuna_registrazione'; end if;

  -- due pizzerie con lo stesso nome si confondono: alla seconda si aggiunge un numero
  v_base := v_nome;
  while exists (select 1 from public.ristoranti where lower(nome) = lower(v_nome)) loop
    n := n + 1;
    v_nome := v_base || ' (' || n || ')';
  end loop;

  insert into public.ristoranti (nome, origine) values (v_nome, 'registrazione') returning id into v_rid;
  insert into public.membri (user_id, ristorante_id, ruolo) values (v_uid, v_rid, 'titolare');
  -- la richiesta è stata usata: se un giorno l'account resta senza pizzeria non ne crea un'altra da solo
  update auth.users
     set raw_user_meta_data = (coalesce(raw_user_meta_data, '{}'::jsonb) - 'pizzeria') || jsonb_build_object('pizzeria_creata', v_rid)
   where id = v_uid;
  return v_rid;
end $$;

revoke all on function public.crea_mia_pizzeria() from public, anon;
grant execute on function public.crea_mia_pizzeria() to authenticated;

-- Controllo: pizzerie nate dalla registrazione, con il titolare
select r.id, r.nome, r.creato_il, u.email as titolare
from public.ristoranti r
join public.membri m on m.ristorante_id = r.id and m.ruolo = 'titolare'
join auth.users u on u.id = m.user_id
where r.origine = 'registrazione'
order by r.creato_il desc;
