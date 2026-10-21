-- =====================================================================
-- Persone della pizzeria (Impostazioni › Persone)
-- Da eseguire dopo supabase-sicurezza.sql. Si può rieseguire.
--
-- - persone_pizzeria: il titolare vede chi fa parte della sua pizzeria,
--   con email e ultimo accesso. Nessun altro può chiamarla con successo.
-- - id_utente_da_email: serve solo a /api/persone (chiave service_role)
--   per sapere se un'email ha già un account. Dall'app non si può usare.
-- Aggiungere, togliere e cambiare password li fa /api/persone, dopo aver
-- controllato che chi chiede sia il titolare.
-- =====================================================================
create or replace function public.persone_pizzeria(p_ristorante uuid)
returns table (utente uuid, email text, ruolo text, ultimo_accesso timestamptz, io boolean)
language plpgsql stable security definer set search_path = public, auth as $$
#variable_conflict use_column
begin
  if not exists (select 1 from public.membri m where m.user_id = auth.uid() and m.ristorante_id = p_ristorante and m.ruolo = 'titolare') then
    raise exception 'non_titolare' using errcode = '42501';
  end if;
  return query
    select m.user_id, u.email::text, m.ruolo, u.last_sign_in_at, m.user_id = auth.uid()
    from public.membri m join auth.users u on u.id = m.user_id
    where m.ristorante_id = p_ristorante
    order by (m.ruolo = 'titolare') desc, lower(u.email);
end $$;

create or replace function public.id_utente_da_email(p_email text)
returns uuid language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;

revoke all on function public.persone_pizzeria(uuid) from public, anon;
grant execute on function public.persone_pizzeria(uuid) to authenticated;
revoke all on function public.id_utente_da_email(text) from public, anon, authenticated;
grant execute on function public.id_utente_da_email(text) to service_role;

notify pgrst, 'reload schema';
