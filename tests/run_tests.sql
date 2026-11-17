\set ON_ERROR_STOP 1
-- Usuarios: admin, alumno A, alumno B
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','admin@x.mx','{"full_name":"Admin","advisor_name":"-","advisor_email":"admin@x.mx"}'),
 ('00000000-0000-0000-0000-00000000000b','ana@x.mx','{"full_name":"Ana","program":"PCeIM","advisor_name":"Dra. Ruiz","advisor_email":"ruiz@x.mx"}'),
 ('00000000-0000-0000-0000-00000000000c','beto@x.mx','{"full_name":"Beto","advisor_name":"Dr. Paz","advisor_email":"paz@x.mx"}');
update profiles set is_admin = true, status = 'activo' where email = 'admin@x.mx';

create temp table d as
  select (gs::date + time '10:00') at time zone 'America/Mexico_City' as t
    from generate_series(current_date + 1, current_date + 40, '1 day') gs
   where extract(isodow from gs) < 6;
grant select on d to authenticated;
create function pg_temp.day(n int) returns timestamptz language sql as $$ select t from d order by t offset n limit 1 $$;

create function pg_temp.try(sql text) returns text language plpgsql as $$
begin execute sql; return 'OK';
exception when others then return 'ERR: ' || sqlerrm; end $$;

set role authenticated;
-- Ana pendiente no puede reservar
set request.uid = '00000000-0000-0000-0000-00000000000b';
select 'pendiente reserva' t, pg_temp.try(format('insert into bookings(user_id,starts_at,ends_at) values (auth.uid(), %L, %L)', pg_temp.day(0), pg_temp.day(0)+interval '2h'));
select 'pendiente no se activa sola' t, pg_temp.try('update profiles set status=''activo'' where id=auth.uid()');
select 'pendiente ve agenda (0)' t, count(*)::text from agenda;

set request.uid = '00000000-0000-0000-0000-00000000000a';
select 'admin aprueba ana' t, pg_temp.try('select admin_set_user_status(''00000000-0000-0000-0000-00000000000b'',''activo'')');
select 'admin aprueba beto' t, pg_temp.try('select admin_set_user_status(''00000000-0000-0000-0000-00000000000c'',''activo'')');

set request.uid = '00000000-0000-0000-0000-00000000000b';
select 'ana no puede aprobar' t, pg_temp.try('select admin_set_user_status(''00000000-0000-0000-0000-00000000000c'',''baja'')');
select 'ana 2h ok' t, pg_temp.try(format('insert into bookings(user_id,starts_at,ends_at) values (auth.uid(), %L, %L)', pg_temp.day(0), pg_temp.day(0)+interval '2h'));
select 'ana bloque 5h' t, pg_temp.try(format('insert into bookings(user_id,starts_at,ends_at) values (auth.uid(), %L, %L)', pg_temp.day(1), pg_temp.day(1)+interval '5h'));
select 'ana 4h ok' t, pg_temp.try(format('insert into bookings(user_id,starts_at,ends_at) values (auth.uid(), %L, %L)', pg_temp.day(1), pg_temp.day(1)+interval '4h'));
select 'ana 2h ok (8h)' t, pg_temp.try(format('insert into bookings(user_id,starts_at,ends_at) values (auth.uid(), %L, %L)', pg_temp.day(2), pg_temp.day(2)+interval '2h'));
select 'ana excede 8h' t, pg_temp.try(format('insert into bookings(user_id,starts_at,ends_at) values (auth.uid(), %L, %L)', pg_temp.day(3), pg_temp.day(3)+interval '30m'));
select 'ana >14 dias' t, pg_temp.try(format('insert into bookings(user_id,starts_at,ends_at) values (auth.uid(), %L, %L)', pg_temp.day(20), pg_temp.day(20)+interval '1h'));
select 'ana no alineado' t, pg_temp.try(format('insert into bookings(user_id,starts_at,ends_at) values (auth.uid(), %L, %L)', pg_temp.day(4)+interval '10m', pg_temp.day(4)+interval '1h'));
select 'ana a nombre de beto' t, pg_temp.try(format('insert into bookings(user_id,starts_at,ends_at) values (''00000000-0000-0000-0000-00000000000c'', %L, %L)', pg_temp.day(5), pg_temp.day(5)+interval '1h'));
select 'ana no puede editar reserva' t, pg_temp.try('update bookings set ends_at = ends_at + interval ''3h''');
select 'ana pide serie' t, pg_temp.try(format('insert into exception_requests(user_id,starts_on,ends_on,max_hours,reason) values (auth.uid(), %L, %L, 20, ''Serie de mapeos'')', pg_temp.day(18)::date, pg_temp.day(22)::date));

set request.uid = '00000000-0000-0000-0000-00000000000c';
select 'beto traslape' t, pg_temp.try(format('insert into bookings(user_id,starts_at,ends_at) values (auth.uid(), %L, %L)', pg_temp.day(0)+interval '1h', pg_temp.day(0)+interval '3h'));
select 'beto ve agenda' t, count(*)::text from agenda;
select 'beto no ve perfiles ajenos' t, count(*)::text from profiles;
select 'beto no cancela de ana' t, pg_temp.try('select cancel_booking((select min(id) from bookings))');

set request.uid = '00000000-0000-0000-0000-00000000000a';
select 'admin aprueba serie' t, pg_temp.try('select admin_decide_exception((select max(id) from exception_requests), true, ''Adelante'')');

set request.uid = '00000000-0000-0000-0000-00000000000b';
select 'ana serie 6h dia 18' t, pg_temp.try(format('insert into bookings(user_id,starts_at,ends_at,exception_id) values (auth.uid(), %L, %L, (select max(id) from exception_requests))', pg_temp.day(18)-interval '2h', pg_temp.day(18)+interval '4h'));
select 'ana serie fuera periodo' t, pg_temp.try(format('insert into bookings(user_id,starts_at,ends_at,exception_id) values (auth.uid(), %L, %L, (select max(id) from exception_requests))', pg_temp.day(25), pg_temp.day(25)+interval '1h'));
select 'ana cancela 1a' t, pg_temp.try('select cancel_booking((select min(id) from bookings))');
select 'ana desactiva avisos' t, pg_temp.try('update profiles set notify_freed=false where id=auth.uid()');

set request.uid = '00000000-0000-0000-0000-00000000000a';
select 'admin da de baja a beto' t, pg_temp.try('select admin_set_user_status(''00000000-0000-0000-0000-00000000000c'',''baja'')');
reset role;
select id, to_emails, cc_emails, array_length(bcc_emails,1) nbcc, subject from email_outbox order by id;
-- Sesión nocturna que cruza la medianoche
set role authenticated;
set request.uid = '00000000-0000-0000-0000-00000000000b';
select 'ana nocturna 23-01' t, pg_temp.try(format('insert into bookings(user_id,starts_at,ends_at) values (auth.uid(), %L, %L)', pg_temp.day(3)+interval '13h', pg_temp.day(3)+interval '15h'));
reset role;

-- Superusuario: sin límites, pero sin traslapes
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000d','caro@x.mx','{"full_name":"Caro","advisor_name":"Dra. Sol","advisor_email":"sol@x.mx"}');
set role authenticated;
set request.uid = '00000000-0000-0000-0000-00000000000b';
select 'ana no se hace superusuario (columna)' t, pg_temp.try('update profiles set is_superuser=true where id=auth.uid()');
select 'ana no puede dar superusuario' t, pg_temp.try('select admin_set_superuser(auth.uid(), true)');
set request.uid = '00000000-0000-0000-0000-00000000000a';
select 'admin superusuario a caro pendiente' t, pg_temp.try('select admin_set_superuser(''00000000-0000-0000-0000-00000000000d'', true)');
set request.uid = '00000000-0000-0000-0000-00000000000d';
select 'caro super pero pendiente' t, pg_temp.try(format('insert into bookings(user_id,starts_at,ends_at) values (auth.uid(), %L, %L)', pg_temp.day(6), pg_temp.day(6)+interval '1h'));
set request.uid = '00000000-0000-0000-0000-00000000000a';
select 'admin aprueba caro' t, pg_temp.try('select admin_set_user_status(''00000000-0000-0000-0000-00000000000d'',''activo'')');
set request.uid = '00000000-0000-0000-0000-00000000000d';
select 'caro super bloque 10h' t, pg_temp.try(format('insert into bookings(user_id,starts_at,ends_at) values (auth.uid(), %L, %L)', pg_temp.day(6), pg_temp.day(6)+interval '10h'));
select 'caro super 30 dias, 20h' t, pg_temp.try(format('insert into bookings(user_id,starts_at,ends_at) values (auth.uid(), %L, %L)', pg_temp.day(21), pg_temp.day(21)+interval '20h'));
select 'caro super fin de semana' t, pg_temp.try(format('insert into bookings(user_id,starts_at,ends_at) values (auth.uid(), %L, %L)',
  (date_trunc('week', current_date + 7) + interval '5 days 10 hours')::timestamp at time zone 'America/Mexico_City',
  (date_trunc('week', current_date + 7) + interval '5 days 14 hours')::timestamp at time zone 'America/Mexico_City'));
select 'caro super traslape con ana' t, pg_temp.try(format('insert into bookings(user_id,starts_at,ends_at) values (auth.uid(), %L, %L)', pg_temp.day(1), pg_temp.day(1)+interval '1h'));
select 'caro super en el pasado' t, pg_temp.try(format('insert into bookings(user_id,starts_at,ends_at) values (auth.uid(), %L, %L)', date_trunc('hour', now()) - interval '3h', date_trunc('hour', now()) - interval '1h'));
set request.uid = '00000000-0000-0000-0000-00000000000a';
select 'admin quita superusuario' t, pg_temp.try('select admin_set_superuser(''00000000-0000-0000-0000-00000000000d'', false)');
set request.uid = '00000000-0000-0000-0000-00000000000d';
select 'caro normal >14 dias' t, pg_temp.try(format('insert into bookings(user_id,starts_at,ends_at) values (auth.uid(), %L, %L)', pg_temp.day(25), pg_temp.day(25)+interval '1h'));
reset role;
select subject from email_outbox where subject like '%superusuario%';

-- Avatares
set role authenticated;
set request.uid = '00000000-0000-0000-0000-00000000000b';
select 'ana elige avatar' t, pg_temp.try('update profiles set avatar = ''🦊'' where id = auth.uid()');
select 'ana avatar demasiado largo' t, pg_temp.try('update profiles set avatar = repeat(''x'', 40) where id = auth.uid()');
select 'ana no cambia avatar de beto' t, (select count(*)::text from profiles where id = '00000000-0000-0000-0000-00000000000c');
select 'ana sigue sin poder hacerse admin' t, pg_temp.try('update profiles set is_admin = true where id = auth.uid()');
set request.uid = '00000000-0000-0000-0000-00000000000d';
select 'caro ve avatar de ana en agenda' t, string_agg(distinct avatar, ',') from agenda where full_name = 'Ana';
reset role;
