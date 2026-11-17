-- =====================================================================
--  Migración 2026-11-17: rol de superusuario (reserva sin límites)
--  Pegar completo en Supabase → SQL Editor → New query → Run.
--  Se puede correr más de una vez sin problema.
-- =====================================================================

alter table public.profiles add column if not exists is_superuser boolean not null default false;

create or replace function public.validate_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cfg   settings;
  prof  profiles;
  exc   exception_requests;
  dur_h numeric;
  used  numeric;
  ls    timestamp;  -- inicio local
  le    timestamp;  -- fin local
begin
  select * into cfg from settings where id = 1;
  select * into prof from profiles where id = new.user_id;

  if prof.id is null then raise exception 'Perfil no encontrado.'; end if;

  -- Sólo el propio usuario (o un administrador) puede crear reservas a su nombre.
  if auth.uid() is not null and new.user_id <> auth.uid() and not is_admin() then
    raise exception 'No puedes reservar a nombre de otra persona.';
  end if;

  new.status := 'activa';
  new.cancelled_at := null;
  new.created_at := now();

  -- Los administradores no tienen límites (mantenimiento, calibración, etc.).
  if prof.is_admin then return new; end if;

  if prof.status <> 'activo' then
    raise exception 'Tu cuenta no está activa. Espera la aprobación del responsable.';
  end if;

  ls := new.starts_at at time zone cfg.timezone;
  le := new.ends_at   at time zone cfg.timezone;
  dur_h := extract(epoch from (new.ends_at - new.starts_at)) / 3600.0;

  if new.starts_at < now() - interval '5 minutes' then
    raise exception 'No se puede reservar en el pasado.';
  end if;
  if (extract(epoch from new.starts_at)::bigint % (cfg.slot_minutes * 60)) <> 0
     or (extract(epoch from new.ends_at)::bigint % (cfg.slot_minutes * 60)) <> 0 then
    raise exception 'Los horarios deben ser múltiplos de % minutos.', cfg.slot_minutes;
  end if;

  -- Superusuarios: sin límites de duración, horas a futuro, anticipación, horario
  -- ni fines de semana. Sólo se respeta que no se traslape con otras reservas.
  if prof.is_superuser then return new; end if;

  -- Con horario 0–24 se permite cruzar la medianoche (sesiones nocturnas).
  if cfg.open_hour > 0 or cfg.close_hour < 24 then
    if ls::date <> (le - interval '1 microsecond')::date then
      raise exception 'Una reserva debe empezar y terminar el mismo día.';
    end if;
    if extract(hour from ls) < cfg.open_hour
       or le > date_trunc('day', ls) + make_interval(hours => cfg.close_hour) then
      raise exception 'Horario permitido: % a % h.', cfg.open_hour, cfg.close_hour;
    end if;
  end if;
  if not cfg.allow_weekends and extract(isodow from ls) in (6, 7) then
    raise exception 'No se reserva en fin de semana.';
  end if;
  if new.exception_id is not null then
    -- Reserva dentro de una serie de experimentos aprobada: límites propios.
    select * into exc from exception_requests where id = new.exception_id;
    if exc.id is null or exc.user_id <> new.user_id or exc.status <> 'aprobada' then
      raise exception 'La solicitud de serie no existe o no está aprobada.';
    end if;
    if ls::date < exc.starts_on or ls::date > exc.ends_on then
      raise exception 'La reserva está fuera del periodo aprobado (% a %).', exc.starts_on, exc.ends_on;
    end if;
    select coalesce(sum(extract(epoch from (ends_at - starts_at)) / 3600.0), 0) into used
      from bookings where exception_id = exc.id and status = 'activa';
    if used + dur_h > exc.max_hours then
      raise exception 'La serie aprobada permite % h; ya llevas % h reservadas.', exc.max_hours, round(used, 1);
    end if;
  else
    if new.starts_at > now() + make_interval(days => cfg.max_days_ahead) then
      raise exception 'Sólo se puede reservar con % días de anticipación como máximo. Para una serie larga de experimentos, envía una solicitud de serie.', cfg.max_days_ahead;
    end if;
    if dur_h > cfg.max_block_hours then
      raise exception 'Una sesión puede durar como máximo % h.', cfg.max_block_hours;
    end if;
    select coalesce(sum(extract(epoch from (ends_at - greatest(starts_at, now()))) / 3600.0), 0) into used
      from bookings
     where user_id = new.user_id and status = 'activa' and exception_id is null and ends_at > now();
    if used + dur_h > cfg.max_future_hours then
      raise exception 'Límite de % h reservadas a futuro (ya tienes % h). Cuando uses o liberes alguna, podrás reservar más.',
        cfg.max_future_hours, round(used, 1);
    end if;
  end if;

  return new;
end $$;


-- Dar o quitar el rol de superusuario (reserva sin límites).
create or replace function public.admin_set_superuser(p_user uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare prof profiles;
begin
  if not is_admin() then raise exception 'Sólo el administrador.'; end if;
  select * into prof from profiles where id = p_user for update;
  if prof.id is null then raise exception 'Usuario no encontrado.'; end if;
  update profiles set is_superuser = p_on where id = p_user;
  if p_on and not prof.is_superuser then
    perform queue_email(array[prof.email], 'Ahora eres superusuario del equipo',
      'Hola ' || prof.full_name || ':' || E'\n\n' ||
      'El responsable te dio el rol de superusuario: puedes reservar el equipo sin los límites normales ' ||
      '(duración, horas a futuro y anticipación). Sólo se evita que choques con otras reservas.');
  end if;
end $$;


-- Para dar el rol por SQL (también se puede desde el panel de Administración):
--   update public.profiles set is_superuser = true where email = 'correo@ejemplo.mx';
