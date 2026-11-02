-- ============================================================
-- Golf en Familia — esquema de Supabase
--
-- Pegar TODO este archivo en Supabase → SQL Editor → Run.
-- Se puede correr varias veces sin problema.
--
-- Modelo: una fila por familia con todo el estado en JSON (el mismo
-- formato que exporta la app, ver docs/HERMES.md). La fila se
-- identifica por el SHA-256 del código de familia.
--
-- Seguridad: la tabla tiene RLS activado y NINGUNA política, así que
-- con la llave pública (anon/publishable) no se puede leer ni escribir
-- directamente. Solo se accede por las funciones golf_get / golf_save,
-- que exigen el código de familia.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.golf_state (
  family_hash text primary key,
  data        jsonb       not null,
  rev         bigint      not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
alter table public.golf_state enable row level security;

-- Historial: cada guardado deja una copia (para recuperar si algo sale mal).
create table if not exists public.golf_state_history (
  id          bigserial primary key,
  family_hash text        not null,
  rev         bigint      not null,
  data        jsonb       not null,
  saved_at    timestamptz not null default now(),
  saved_by    text
);
create index if not exists golf_state_history_family on public.golf_state_history (family_hash, rev desc);
alter table public.golf_state_history enable row level security;

-- Códigos retirados (cambiados por uno nuevo): impide que un celular con el
-- código viejo cree una familia vacía por accidente.
create table if not exists public.golf_retired (
  family_hash text primary key,
  retired_at  timestamptz not null default now()
);
alter table public.golf_retired enable row level security;

create or replace function public.golf_hash(p_code text)
returns text language sql immutable
set search_path = public, extensions as $$
  select encode(extensions.digest(p_code, 'sha256'), 'hex');
$$;

-- Leer el estado de la familia. Devuelve null si la familia no existe aún.
create or replace function public.golf_get(p_code text)
returns json language sql stable security definer
set search_path = public, extensions as $$
  select json_build_object('rev', rev, 'data', data, 'updated_at', updated_at, 'updated_by', updated_by)
  from public.golf_state
  where family_hash = public.golf_hash(p_code);
$$;

-- Guardar con control de versión optimista.
--   p_rev = la versión que el cliente tenía. Si alguien guardó antes,
--   NO se guarda y se devuelve {ok:false, rev, data} para que el cliente mezcle.
--   p_rev = 0 crea la familia si no existe.
create or replace function public.golf_save(p_code text, p_rev bigint, p_data jsonb, p_by text default null)
returns json language plpgsql security definer
set search_path = public, extensions as $$
declare
  h   text := public.golf_hash(p_code);
  cur public.golf_state;
begin
  if p_code is null or length(p_code) < 8 then
    raise exception 'El código de familia debe tener al menos 8 caracteres';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Datos inválidos';
  end if;
  if octet_length(p_data::text) > 5000000 then
    raise exception 'Datos demasiado grandes';
  end if;

  select * into cur from public.golf_state where family_hash = h for update;

  if not found then
    if exists (select 1 from public.golf_retired where family_hash = h) then
      raise exception 'codigo_retirado: este código de familia ya no se usa; pide el código nuevo';
    end if;
    if p_rev <> 0 then
      return json_build_object('ok', false, 'rev', 0, 'data', null);
    end if;
    insert into public.golf_state (family_hash, data, rev, updated_by) values (h, p_data, 1, p_by);
    insert into public.golf_state_history (family_hash, rev, data, saved_by) values (h, 1, p_data, p_by);
    return json_build_object('ok', true, 'rev', 1);
  end if;

  if cur.rev <> p_rev then
    return json_build_object('ok', false, 'rev', cur.rev, 'data', cur.data);
  end if;

  update public.golf_state
     set data = p_data, rev = cur.rev + 1, updated_at = now(), updated_by = p_by
   where family_hash = h;
  insert into public.golf_state_history (family_hash, rev, data, saved_by) values (h, cur.rev + 1, p_data, p_by);
  -- conservar solo las últimas 500 versiones por familia
  delete from public.golf_state_history
   where family_hash = h and rev <= cur.rev + 1 - 500;
  return json_build_object('ok', true, 'rev', cur.rev + 1);
end;
$$;

-- Ver versiones anteriores (para recuperar). Devuelve las últimas N sin el JSON completo.
create or replace function public.golf_history(p_code text, p_limit int default 50)
returns json language sql stable security definer
set search_path = public, extensions as $$
  select coalesce(json_agg(x order by x.rev desc), '[]'::json) from (
    select rev, saved_at, saved_by from public.golf_state_history
    where family_hash = public.golf_hash(p_code)
    order by rev desc limit least(coalesce(p_limit, 50), 500)
  ) x;
$$;

-- Traer una versión anterior completa.
create or replace function public.golf_get_version(p_code text, p_rev bigint)
returns json language sql stable security definer
set search_path = public, extensions as $$
  select json_build_object('rev', rev, 'data', data, 'saved_at', saved_at, 'saved_by', saved_by)
  from public.golf_state_history
  where family_hash = public.golf_hash(p_code) and rev = p_rev;
$$;

-- Cambiar el código de una familia (solo administrador, desde el SQL Editor):
--   select public.golf_change_code('CODIGO-VIEJO', 'CODIGO-NUEVO');
-- Los códigos se guardan como los manda la app: sin espacios y en MAYÚSCULAS.
create or replace function public.golf_change_code(p_old text, p_new text)
returns json language plpgsql security definer
set search_path = public, extensions as $$
declare
  ho text := public.golf_hash(p_old);
  hn text := public.golf_hash(p_new);
begin
  if p_new is null or length(p_new) < 8 then raise exception 'El código nuevo debe tener al menos 8 caracteres'; end if;
  if not exists (select 1 from public.golf_state where family_hash = ho) then raise exception 'El código viejo no existe'; end if;
  if exists (select 1 from public.golf_state where family_hash = hn) then raise exception 'El código nuevo ya está en uso'; end if;
  update public.golf_state set family_hash = hn where family_hash = ho;
  update public.golf_state_history set family_hash = hn where family_hash = ho;
  insert into public.golf_retired (family_hash) values (ho) on conflict do nothing;
  delete from public.golf_retired where family_hash = hn;
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.golf_change_code(text, text) from public, anon, authenticated;

revoke all on function public.golf_get(text)                         from public;
revoke all on function public.golf_save(text, bigint, jsonb, text)    from public;
revoke all on function public.golf_history(text, int)                 from public;
revoke all on function public.golf_get_version(text, bigint)          from public;
grant execute on function public.golf_get(text)                      to anon, authenticated;
grant execute on function public.golf_save(text, bigint, jsonb, text) to anon, authenticated;
grant execute on function public.golf_history(text, int)              to anon, authenticated;
grant execute on function public.golf_get_version(text, bigint)       to anon, authenticated;
