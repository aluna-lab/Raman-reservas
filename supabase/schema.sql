-- =====================================================================
--  Sistema de reservación del microscopio Raman RMS1000 (CFATA, UNAM)
--  Ejecutar completo en Supabase: Dashboard → SQL Editor → New query.
--  Es idempotente en lo posible, pero está pensado para un proyecto nuevo.
-- =====================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- Configuración (una sola fila, editable desde el panel de administración)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id                 int primary key default 1 check (id = 1),
  instrument_name    text    not null default 'Microscopio Raman RMS1000',
  timezone           text    not null default 'America/Mexico_City',
  max_days_ahead     int     not null default 14,   -- ventana máxima para reservar
  max_future_hours   numeric not null default 8,    -- horas reservadas a futuro por usuario
  max_block_hours    numeric not null default 4,    -- duración máxima de una sesión
  slot_minutes       int     not null default 30,   -- granularidad de la agenda
  open_hour          int     not null default 0,    -- hora de apertura (local); 0 y 24 = abierto todo el día
  close_hour         int     not null default 24,   -- hora de cierre (local); con 0–24 se permiten sesiones nocturnas
  allow_weekends     boolean not null default false,
  freed_notice_hours int     not null default 72,   -- avisar huecos liberados dentro de este horizonte
  site_url           text    not null default 'https://aluna-lab.github.io/Raman-reservas/'
);
insert into public.settings (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------
-- Perfiles de usuario
-- ---------------------------------------------------------------------
do $$ begin
  create type public.user_status as enum ('pendiente', 'activo', 'baja');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id             uuid primary key references auth.users on delete cascade,
  email          text not null,
  full_name      text not null,
  program        text,                 -- posgrado / adscripción
  advisor_name   text not null,
  advisor_email  text not null,
  status         public.user_status not null default 'pendiente',
  is_admin       boolean not null default false,
  notify_freed   boolean not null default true,  -- recibir avisos de horarios liberados
  created_at     timestamptz not null default now(),
  decided_at     timestamptz
);

-- ---------------------------------------------------------------------
-- Solicitudes de serie de experimentos (excepción a los límites)
-- ---------------------------------------------------------------------
create table if not exists public.exception_requests (
  id          bigserial primary key,
  user_id     uuid not null references public.profiles on delete cascade,
  starts_on   date not null,
  ends_on     date not null,
  max_hours   numeric not null check (max_hours > 0),
  reason      text not null,
  status      text not null default 'pendiente' check (status in ('pendiente', 'aprobada', 'rechazada')),
  admin_note  text,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  check (ends_on >= starts_on)
);

-- ---------------------------------------------------------------------
-- Reservas
-- ---------------------------------------------------------------------
create table if not exists public.bookings (
  id            bigserial primary key,
  user_id       uuid not null references public.profiles on delete cascade,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  note          text,
  exception_id  bigint references public.exception_requests on delete set null,
  status        text not null default 'activa' check (status in ('activa', 'cancelada')),
  cancelled_at  timestamptz,
  created_at    timestamptz not null default now(),
  check (ends_at > starts_at),
  -- Dos reservas activas no pueden traslaparse.
  constraint bookings_no_overlap exclude using gist (
    tstzrange(starts_at, ends_at) with &&
  ) where (status = 'activa')
);
create index if not exists bookings_user_idx  on public.bookings (user_id, starts_at);
create index if not exists bookings_start_idx on public.bookings (starts_at);

-- ---------------------------------------------------------------------
-- Bandeja de correos salientes (la procesa la Edge Function send-emails)
-- ---------------------------------------------------------------------
create table if not exists public.email_outbox (
  id          bigserial primary key,
  to_emails   text[] not null default '{}',
  cc_emails   text[] not null default '{}',
  bcc_emails  text[] not null default '{}',
  subject     text not null,
  body        text not null,          -- texto plano
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  attempts    int not null default 0,
  last_error  text
);
create index if not exists email_outbox_pending_idx on public.email_outbox (id) where sent_at is null;

-- =====================================================================
--  Funciones auxiliares
-- =====================================================================
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'activo' or is_admin from profiles where id = auth.uid()), false);
$$;

create or replace function public.admin_emails() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(email), '{}') from profiles where is_admin and status <> 'baja';
$$;

-- Formato legible de un intervalo en hora local.
create or replace function public.fmt_range(s timestamptz, e timestamptz) returns text
language sql stable set search_path = public as $$
  select to_char(s at time zone tz, 'DD/MM/YYYY HH24:MI') || '–' ||
         case when (s at time zone tz)::date = (e at time zone tz)::date
              then to_char(e at time zone tz, 'HH24:MI')
              else to_char(e at time zone tz, 'DD/MM/YYYY HH24:MI') end
  from (select timezone as tz from settings where id = 1) c;
$$;

create or replace function public.queue_email(
  p_to text[], p_subject text, p_body text, p_cc text[] default '{}', p_bcc text[] default '{}'
) returns void language plpgsql security definer set search_path = public as $$
declare
  instr text;
  url   text;
begin
  select instrument_name, site_url into instr, url from settings where id = 1;
  if coalesce(array_length(p_to, 1), 0) + coalesce(array_length(p_cc, 1), 0)
     + coalesce(array_length(p_bcc, 1), 0) = 0 then
    return;
  end if;
  insert into email_outbox (to_emails, cc_emails, bcc_emails, subject, body)
  values (p_to, coalesce(p_cc, '{}'), coalesce(p_bcc, '{}'),
          '[' || instr || '] ' || p_subject,
          p_body || E'\n\n—\nSistema de reservación · ' || instr || E'\n' || url);
end $$;

-- =====================================================================
--  Alta de perfil al registrarse (los datos vienen en raw_user_meta_data)
-- =====================================================================
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into profiles (id, email, full_name, program, advisor_name, advisor_email)
  values (new.id, lower(new.email),
          coalesce(nullif(trim(m->>'full_name'), ''), new.email),
          nullif(trim(m->>'program'), ''),
          coalesce(nullif(trim(m->>'advisor_name'), ''), '(sin asesor)'),
          lower(coalesce(nullif(trim(m->>'advisor_email'), ''), new.email)))
  on conflict (id) do nothing;

  perform queue_email(
    admin_emails(),
    'Nueva solicitud de registro: ' || coalesce(m->>'full_name', new.email),
    'Se registró un nuevo usuario y está pendiente de aprobación.' || E'\n\n' ||
    'Nombre: '  || coalesce(m->>'full_name', '') || E'\n' ||
    'Correo: '  || new.email || E'\n' ||
    'Programa: '|| coalesce(m->>'program', '') || E'\n' ||
    'Asesor: '  || coalesce(m->>'advisor_name', '') || ' <' || coalesce(m->>'advisor_email', '') || '>' || E'\n\n' ||
    'Apruébalo o recházalo desde el panel de administración.');
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
--  Reglas de reserva (se aplican siempre, sin importar el cliente)
-- =====================================================================
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
  if (extract(epoch from new.starts_at)::bigint % (cfg.slot_minutes * 60)) <> 0
     or (extract(epoch from new.ends_at)::bigint % (cfg.slot_minutes * 60)) <> 0 then
    raise exception 'Los horarios deben ser múltiplos de % minutos.', cfg.slot_minutes;
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

drop trigger if exists bookings_validate on public.bookings;
create trigger bookings_validate before insert on public.bookings
  for each row execute function public.validate_booking();

-- Aviso al asesor principal (y copia al usuario) en cada reserva nueva.
create or replace function public.notify_booking_created() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  prof profiles;
  exc_txt text := '';
begin
  select * into prof from profiles where id = new.user_id;
  if new.exception_id is not null then
    select E'\nParte de la serie de experimentos aprobada: ' || reason into exc_txt
      from exception_requests where id = new.exception_id;
  end if;
  perform queue_email(
    array[prof.advisor_email],
    'Reserva de ' || prof.full_name || ': ' || fmt_range(new.starts_at, new.ends_at),
    'Estimado(a) ' || prof.advisor_name || ':' || E'\n\n' ||
    'Le informamos que ' || prof.full_name || ' reservó el equipo:' || E'\n\n' ||
    '  Horario: ' || fmt_range(new.starts_at, new.ends_at) || E'\n' ||
    coalesce('  Nota: ' || nullif(new.note, '') || E'\n', '') || exc_txt || E'\n\n' ||
    'Este aviso es automático; no requiere respuesta.',
    array[prof.email]);
  return new;
end $$;

drop trigger if exists bookings_notify_created on public.bookings;
create trigger bookings_notify_created after insert on public.bookings
  for each row execute function public.notify_booking_created();

-- Avisa a los usuarios activos que se liberó un horario próximo.
create or replace function public.announce_freed_slot(p_start timestamptz, p_end timestamptz, p_except uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  cfg settings;
  rcpt text[];
  s timestamptz := greatest(p_start, now());
begin
  select * into cfg from settings where id = 1;
  if p_end <= s or s > now() + make_interval(hours => cfg.freed_notice_hours) then
    return;
  end if;
  select coalesce(array_agg(email), '{}') into rcpt
    from profiles where status = 'activo' and notify_freed and id <> coalesce(p_except, gen_random_uuid());
  perform queue_email(
    '{}',
    'Horario disponible: ' || fmt_range(s, p_end),
    'Se liberó un horario del equipo:' || E'\n\n' ||
    '  ' || fmt_range(s, p_end) || E'\n\n' ||
    'Si lo necesitas, entra al sistema y resérvalo. El primero que lo reserve se lo queda.' || E'\n' ||
    '(Puedes desactivar estos avisos en "Mi perfil".)',
    '{}', rcpt);
end $$;

-- =====================================================================
--  Acciones (RPC) para usuarios
-- =====================================================================

-- Cancelar una reserva futura, o liberar el resto de una sesión en curso.
create or replace function public.cancel_booking(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare
  b bookings;
  prof profiles;
  cfg settings;
  cut timestamptz;
  freed_from timestamptz;
  action text;
begin
  select * into b from bookings where id = p_id for update;
  if b.id is null or b.status <> 'activa' then raise exception 'Reserva no encontrada.'; end if;
  if b.user_id <> auth.uid() and not is_admin() then raise exception 'Sin permiso.'; end if;
  if b.ends_at <= now() then raise exception 'La reserva ya terminó.'; end if;
  select * into prof from profiles where id = b.user_id;
  select * into cfg from settings where id = 1;

  if b.starts_at > now() then
    update bookings set status = 'cancelada', cancelled_at = now() where id = p_id;
    freed_from := b.starts_at;
    action := 'canceló';
  else
    -- Sesión en curso: se recorta al siguiente múltiplo de slot_minutes.
    cut := to_timestamp(ceil(extract(epoch from now()) / (cfg.slot_minutes * 60)) * (cfg.slot_minutes * 60));
    if cut >= b.ends_at then return 'La sesión ya está por terminar; no hay tiempo que liberar.'; end if;
    update bookings set ends_at = cut where id = p_id;
    freed_from := cut;
    action := 'terminó antes y liberó';
  end if;

  perform queue_email(
    array[prof.advisor_email],
    prof.full_name || ' ' || action || ' su reserva: ' || fmt_range(b.starts_at, b.ends_at),
    'Estimado(a) ' || prof.advisor_name || ':' || E'\n\n' ||
    prof.full_name || ' ' || action || ' la reserva ' || fmt_range(b.starts_at, b.ends_at) ||
    case when b.user_id <> auth.uid() then ' (acción del administrador)' else '' end || '.' || E'\n\n' ||
    'Este aviso es automático; no requiere respuesta.',
    array[prof.email]);

  perform announce_freed_slot(freed_from, b.ends_at, b.user_id);
  return case when action = 'canceló' then 'Reserva cancelada.' else 'Tiempo restante liberado.' end;
end $$;

-- Solicitar una serie de experimentos (excepción a los límites).
create or replace function public.notify_exception_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare prof profiles;
begin
  select * into prof from profiles where id = new.user_id;
  if tg_op = 'INSERT' then
    perform queue_email(
      admin_emails(),
      'Solicitud de serie de experimentos: ' || prof.full_name,
      prof.full_name || ' (asesor: ' || prof.advisor_name || ') solicita una serie de experimentos:' || E'\n\n' ||
      '  Periodo: ' || to_char(new.starts_on, 'DD/MM/YYYY') || ' a ' || to_char(new.ends_on, 'DD/MM/YYYY') || E'\n' ||
      '  Horas solicitadas: ' || new.max_hours || E'\n' ||
      '  Motivo: ' || new.reason || E'\n\n' ||
      'Apruébala o recházala desde el panel de administración.');
  elsif new.status <> old.status and new.status in ('aprobada', 'rechazada') then
    perform queue_email(
      array[prof.email],
      'Tu solicitud de serie fue ' || new.status,
      'Tu solicitud de serie de experimentos (' || to_char(new.starts_on, 'DD/MM/YYYY') || ' a ' ||
      to_char(new.ends_on, 'DD/MM/YYYY') || ', ' || new.max_hours || ' h) fue ' || new.status || '.' ||
      coalesce(E'\n\nComentario: ' || nullif(new.admin_note, ''), '') ||
      case when new.status = 'aprobada'
           then E'\n\nAl reservar, elige esta serie en el campo "Serie de experimentos".' else '' end,
      array[prof.advisor_email]);
  end if;
  return new;
end $$;

drop trigger if exists exception_requests_notify on public.exception_requests;
create trigger exception_requests_notify after insert or update on public.exception_requests
  for each row execute function public.notify_exception_request();

create or replace function public.guard_exception_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not is_active() then raise exception 'Tu cuenta no está activa.'; end if;
    new.user_id := auth.uid();
    new.status := 'pendiente';
    new.decided_at := null;
    new.admin_note := null;
    if new.starts_on < current_date then raise exception 'El periodo no puede empezar en el pasado.'; end if;
  end if;
  return new;
end $$;

drop trigger if exists exception_requests_guard on public.exception_requests;
create trigger exception_requests_guard before insert on public.exception_requests
  for each row execute function public.guard_exception_request();

-- =====================================================================
--  Acciones (RPC) del administrador
-- =====================================================================
create or replace function public.admin_set_user_status(p_user uuid, p_status public.user_status)
returns void language plpgsql security definer set search_path = public as $$
declare prof profiles; n int := 0;
begin
  if not is_admin() then raise exception 'Sólo el administrador.'; end if;
  select * into prof from profiles where id = p_user for update;
  if prof.id is null then raise exception 'Usuario no encontrado.'; end if;
  update profiles set status = p_status, decided_at = now() where id = p_user;

  if p_status = 'activo' and prof.status <> 'activo' then
    perform queue_email(array[prof.email], 'Tu cuenta fue aprobada',
      'Hola ' || prof.full_name || ':' || E'\n\n' ||
      'Tu cuenta en el sistema de reservación ya está activa. Ya puedes reservar el equipo.');
  elsif p_status = 'baja' and prof.status <> 'baja' then
    -- Cancela sus reservas futuras y avisa de cada horario liberado.
    declare b record;
    begin
      for b in select * from bookings where user_id = p_user and status = 'activa' and starts_at > now() loop
        update bookings set status = 'cancelada', cancelled_at = now() where id = b.id;
        perform announce_freed_slot(b.starts_at, b.ends_at, p_user);
        n := n + 1;
      end loop;
    end;
    if prof.status = 'activo' then
      perform queue_email(array[prof.email], 'Tu cuenta fue dada de baja',
        'Hola ' || prof.full_name || ':' || E'\n\n' ||
        'Tu cuenta en el sistema de reservación fue dada de baja' ||
        case when n > 0 then ' y se cancelaron ' || n || ' reserva(s) futura(s)' else '' end || '.' || E'\n' ||
        'Si crees que es un error, contacta al responsable del equipo.');
    end if;
  end if;
end $$;

create or replace function public.admin_decide_exception(p_id bigint, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Sólo el administrador.'; end if;
  update exception_requests
     set status = case when p_approve then 'aprobada' else 'rechazada' end,
         admin_note = nullif(trim(p_note), ''), decided_at = now()
   where id = p_id;
end $$;

-- =====================================================================
--  Vista de la agenda (todos los usuarios activos ven quién reservó)
-- =====================================================================
create or replace view public.agenda as
  select b.id, b.user_id, b.starts_at, b.ends_at, b.note, b.exception_id,
         p.full_name, p.advisor_name, (b.user_id = auth.uid()) as mine
    from public.bookings b join public.profiles p on p.id = b.user_id
   where b.status = 'activa' and public.is_active();

-- =====================================================================
--  Seguridad a nivel de fila (RLS)
-- =====================================================================
alter table public.settings           enable row level security;
alter table public.profiles           enable row level security;
alter table public.bookings           enable row level security;
alter table public.exception_requests enable row level security;
alter table public.email_outbox       enable row level security;  -- sin políticas: sólo service_role

drop policy if exists settings_read   on public.settings;
drop policy if exists settings_admin  on public.settings;
create policy settings_read  on public.settings for select to authenticated using (true);
create policy settings_admin on public.settings for update to authenticated using (is_admin()) with check (is_admin());

drop policy if exists profiles_self  on public.profiles;
drop policy if exists profiles_admin on public.profiles;
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_self  on public.profiles for select to authenticated using (id = auth.uid() or is_admin());
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists bookings_read   on public.bookings;
drop policy if exists bookings_insert on public.bookings;
create policy bookings_read   on public.bookings for select to authenticated using (user_id = auth.uid() or is_admin());
create policy bookings_insert on public.bookings for insert to authenticated with check (user_id = auth.uid() or is_admin());

drop policy if exists exc_read   on public.exception_requests;
drop policy if exists exc_insert on public.exception_requests;
create policy exc_read   on public.exception_requests for select to authenticated using (user_id = auth.uid() or is_admin());
create policy exc_insert on public.exception_requests for insert to authenticated with check (true);

-- Privilegios por columna: un usuario sólo puede editar estos campos de su perfil.
revoke update on public.profiles from authenticated, anon;
grant  update (full_name, program, advisor_name, advisor_email, notify_freed) on public.profiles to authenticated;
revoke update, delete on public.bookings from authenticated, anon;
revoke update, delete on public.exception_requests from authenticated, anon;
revoke all on public.email_outbox from authenticated, anon;
revoke all on public.settings from anon;
grant select on public.agenda to authenticated;
revoke all on public.agenda from anon;

revoke execute on function public.queue_email(text[], text, text, text[], text[]) from public, anon, authenticated;
revoke execute on function public.announce_freed_slot(timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function public.admin_emails() from public, anon, authenticated;

-- =====================================================================
--  Primer administrador: después de registrarte en la página, ejecuta
--  (cambiando el correo):
--
--    update public.profiles set is_admin = true, status = 'activo'
--     where email = 'tu-correo@ejemplo.mx';
--    update public.settings set site_url = 'https://aluna-lab.github.io/Raman-reservas/';
-- =====================================================================
