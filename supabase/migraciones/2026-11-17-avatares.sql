-- =====================================================================
--  Migración 2026-11-17: avatares de usuario
--  Pegar completo en Supabase → SQL Editor → New query → Run.
--  Se puede correr más de una vez sin problema.
-- =====================================================================

-- 1) Columna para el avatar (un emoji; vacío = el sitio asigna uno automático).
alter table public.profiles add column if not exists avatar text;
alter table public.profiles drop constraint if exists profiles_avatar_corto;
alter table public.profiles add constraint profiles_avatar_corto
  check (avatar is null or char_length(avatar) between 1 and 16);

-- 2) Cada persona puede cambiar su propio avatar (además de sus datos de siempre).
revoke update on public.profiles from authenticated, anon;
grant  update (full_name, program, advisor_name, advisor_email, notify_freed, avatar)
  on public.profiles to authenticated;

-- 3) La agenda muestra el avatar de quien reservó.
create or replace view public.agenda as
  select b.id, b.user_id, b.starts_at, b.ends_at, b.note, b.exception_id,
         p.full_name, p.advisor_name, (b.user_id = auth.uid()) as mine, p.avatar
    from public.bookings b join public.profiles p on p.id = b.user_id
   where b.status = 'activa' and public.is_active();
grant select on public.agenda to authenticated;

select 'Listo: avatares activados' as resultado;
