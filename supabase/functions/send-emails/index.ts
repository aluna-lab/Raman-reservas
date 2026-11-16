// Edge Function: envía los correos pendientes de public.email_outbox por SMTP.
// La invoca pg_cron cada minuto cuando hay correos pendientes
// (ver supabase/cron.sql). Desplegar con --no-verify-jwt; se protege con CRON_SECRET.
//
// Secretos necesarios (supabase secrets set ...):
//   SMTP_HOST (p. ej. smtp.gmail.com), SMTP_PORT (465), SMTP_USER, SMTP_PASS,
//   MAIL_FROM (p. ej. "Raman RMS1000 <raman.cfata@gmail.com>"), CRON_SECRET
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase automáticamente.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import nodemailer from "npm:nodemailer@6.9.15";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const port = Number(Deno.env.get("SMTP_PORT") ?? "465");
const transport = nodemailer.createTransport({
  host: Deno.env.get("SMTP_HOST"),
  port,
  secure: port === 465,
  auth: { user: Deno.env.get("SMTP_USER"), pass: Deno.env.get("SMTP_PASS") },
});
const FROM = Deno.env.get("MAIL_FROM") ?? Deno.env.get("SMTP_USER")!;
const MAX_BCC = 45; // Gmail limita destinatarios por mensaje

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (secret && req.headers.get("x-cron-secret") !== secret) {
    return new Response("unauthorized", { status: 401 });
  }

  const { data: rows, error } = await supabase
    .from("email_outbox")
    .select("*")
    .is("sent_at", null)
    .lt("attempts", 5)
    .order("id")
    .limit(30);
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0;
  for (const m of rows ?? []) {
    // Marca el intento antes de enviar para no duplicar si dos invocaciones coinciden.
    const { data: claimed } = await supabase
      .from("email_outbox")
      .update({ attempts: m.attempts + 1 })
      .eq("id", m.id)
      .eq("attempts", m.attempts)
      .is("sent_at", null)
      .select("id");
    if (!claimed?.length) continue;

    try {
      const bcc: string[] = m.bcc_emails ?? [];
      const chunks = bcc.length ? [] as string[][] : [[]];
      for (let i = 0; i < bcc.length; i += MAX_BCC) chunks.push(bcc.slice(i, i + MAX_BCC));
      for (const chunk of chunks) {
        await transport.sendMail({
          from: FROM,
          to: m.to_emails?.length ? m.to_emails : FROM,
          cc: m.cc_emails?.length ? m.cc_emails : undefined,
          bcc: chunk.length ? chunk : undefined,
          subject: m.subject,
          text: m.body,
        });
      }
      await supabase.from("email_outbox")
        .update({ sent_at: new Date().toISOString(), last_error: null })
        .eq("id", m.id);
      sent++;
    } catch (e) {
      await supabase.from("email_outbox")
        .update({ last_error: String(e).slice(0, 500) })
        .eq("id", m.id);
    }
  }
  return Response.json({ pending: rows?.length ?? 0, sent });
});
