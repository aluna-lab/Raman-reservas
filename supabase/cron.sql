-- Procesa la bandeja de correo cada minuto (sólo llama a la función si hay pendientes)
-- (pg_cron dentro de Supabase no cuenta como actividad; para evitar la pausa
-- por inactividad está .github/workflows/keepalive.yml).
-- Requiere habilitar las extensiones pg_cron y pg_net (Database → Extensions).
-- Reemplaza PROJECT_REF y CRON_SECRET antes de ejecutar.

select cron.schedule(
  'send-emails',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://PROJECT_REF.supabase.co/functions/v1/send-emails',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'CRON_SECRET'),
    body    := '{}'::jsonb
  ) where exists (select 1 from public.email_outbox where sent_at is null and attempts < 5);
  $$
);
