-- =====================================================================
-- Blocco 2: letture AI con rimborso solo della lettura non riuscita
-- SQL Editor › New query › incolla › Run. Si può rieseguire.
--
-- Ogni lettura riceve un id che conosce solo /api/claude. Il rimborso
-- vale solo per quell'id, una volta, entro 5 minuti: chiamare il
-- rimborso dall'app o dall'API non azzera più il limite giornaliero.
-- =====================================================================
create table if not exists public.letture_ai (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  giorno date not null,
  stato text not null default 'in_corso' check (stato in ('in_corso', 'ok', 'rimborsata')),
  creato_il timestamptz not null default now()
);
create index if not exists letture_ai_rist_giorno_idx on public.letture_ai (ristorante_id, giorno);

-- nessuna regola: la tabella si legge e si scrive solo con le funzioni qui sotto
alter table public.letture_ai enable row level security;
revoke all on public.letture_ai from anon, authenticated;

-- conta una lettura AI (massimo 100 al giorno per pizzeria, ora italiana) e ne restituisce l'id
create or replace function public.consuma_lettura_ai(p_ristorante uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v integer; v_giorno date := (now() at time zone 'Europe/Rome')::date; v_id uuid;
begin
  -- la lettura dei documenti è solo del titolare
  if not exists (select 1 from public.membri where user_id = auth.uid() and ristorante_id = p_ristorante and ruolo = 'titolare') then
    raise exception 'non_membro' using errcode = '42501';
  end if;
  insert into public.uso_ai (ristorante_id, giorno, conteggio)
  values (p_ristorante, v_giorno, 1)
  on conflict (ristorante_id, giorno) do update set conteggio = public.uso_ai.conteggio + 1
  where public.uso_ai.conteggio < 100
  returning conteggio into v;
  if v is null then return jsonb_build_object('ok', false, 'conteggio', 100); end if;
  insert into public.letture_ai (ristorante_id, user_id, giorno) values (p_ristorante, auth.uid(), v_giorno) returning id into v_id;
  return jsonb_build_object('ok', true, 'conteggio', v, 'lettura', v_id);
end $$;

-- la vecchia versione accettava l'id della pizzeria e si poteva richiamare all'infinito
drop function if exists public.rimborsa_lettura_ai(uuid);

-- rimborsa una lettura non riuscita: solo chi l'ha avviata, solo se ancora in corso, entro 5 minuti
create function public.rimborsa_lettura_ai(p_lettura uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.letture_ai;
begin
  update public.letture_ai set stato = 'rimborsata'
   where id = p_lettura and user_id = auth.uid() and stato = 'in_corso' and creato_il > now() - interval '5 minutes'
  returning * into r;
  if r.id is null then return false; end if;
  update public.uso_ai set conteggio = greatest(conteggio - 1, 0)
   where ristorante_id = r.ristorante_id and giorno = r.giorno;
  return true;
end $$;

-- segna come riuscita una lettura (da quel momento non è più rimborsabile)
create or replace function public.chiudi_lettura_ai(p_lettura uuid)
returns void language sql security definer set search_path = public as $$
  update public.letture_ai set stato = 'ok' where id = p_lettura and user_id = auth.uid() and stato = 'in_corso';
$$;

revoke all on function public.consuma_lettura_ai(uuid) from public, anon;
revoke all on function public.rimborsa_lettura_ai(uuid) from public, anon;
revoke all on function public.chiudi_lettura_ai(uuid) from public, anon;
grant execute on function public.consuma_lettura_ai(uuid) to authenticated;
grant execute on function public.rimborsa_lettura_ai(uuid) to authenticated;
grant execute on function public.chiudi_lettura_ai(uuid) to authenticated;

notify pgrst, 'reload schema';
