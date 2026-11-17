# Reservación del microscopio Raman RMS1000 · CFATA UNAM

Sistema web para reservar el microscopio Raman. Sustituye al calendario de Google con:

- **Registro en línea** con aprobación del responsable, que también puede dar de baja usuarios.
- **Límites contra el acaparamiento** (ajustables en el panel): hasta 8 h reservadas a futuro por usuario,
  sesiones de máximo 4 h y máximo 14 días de anticipación. Se puede reservar desde un día antes y a cualquier
  hora, incluidas sesiones nocturnas que cruzan la medianoche.
- **Series de experimentos**: el usuario pide un periodo y un total de horas con una línea de justificación; si el
  responsable la aprueba, puede reservar en ese periodo sin los límites normales.
- **Aviso por correo al asesor(a) principal** en cada reserva, cancelación y serie aprobada.
- **Horarios liberados**: cuando alguien cancela, o termina antes y libera el resto de su sesión, se avisa por correo
  a todos los usuarios activos (sólo para huecos de las próximas 72 h; cada quien puede desactivar estos avisos).

Las reglas se aplican en la base de datos (`supabase/schema.sql`), así que no se pueden saltar desde el navegador.

## Arquitectura

| Pieza | Servicio | Costo |
|---|---|---|
| Página web (`index.html`, `app.js`, `styles.css`) | GitHub Pages | gratis (repo público) |
| Usuarios, reservas y reglas | Supabase (Postgres + Auth) | plan gratuito |
| Envío de correos | Edge Function `send-emails` + SMTP de Gmail | gratis |
| Mantener activo Supabase | GitHub Actions (`keepalive.yml`) | gratis |

## Instalación (una sola vez, ~30 min)

### 1. Supabase
1. Crea una cuenta en <https://supabase.com> y un proyecto nuevo (región: `us-east` o la más cercana).
2. **SQL Editor → New query**: pega todo `supabase/schema.sql` y ejecútalo.
3. **Project Settings → API**: copia *Project URL* y *anon public key* en `config.js`.
4. **Authentication → URL Configuration**: en *Site URL* pon la dirección de GitHub Pages
   (p. ej. `https://aluna-lab.github.io/Raman-reservas/`) y agrégala también en *Redirect URLs*.
5. **Authentication → Emails → SMTP Settings**: activa *Custom SMTP* con la misma cuenta de Gmail del paso 2
   (el correo integrado de Supabase sólo permite unos cuantos correos por hora). Opcional: traduce las
   plantillas de *Confirm signup* y *Reset password* al español.

### 2. Correo saliente (Gmail)
1. Usa una cuenta de Gmail del laboratorio (p. ej. `raman.cfata@gmail.com`) con verificación en dos pasos.
2. Crea una *contraseña de aplicación* en <https://myaccount.google.com/apppasswords>.
3. Instala la CLI de Supabase (<https://supabase.com/docs/guides/cli>) y, desde la carpeta del repo:
   ```bash
   supabase login
   supabase link --project-ref PROJECT_REF
   supabase secrets set SMTP_HOST=smtp.gmail.com SMTP_PORT=465 \
     SMTP_USER=raman.cfata@gmail.com SMTP_PASS='contraseña-de-aplicación' \
     MAIL_FROM='Raman RMS1000 <raman.cfata@gmail.com>' CRON_SECRET='una-cadena-larga-al-azar'
   supabase functions deploy send-emails --no-verify-jwt
   ```
4. **Database → Extensions**: habilita `pg_cron` y `pg_net`. Luego, en el SQL Editor, ejecuta
   `supabase/cron.sql` cambiando `PROJECT_REF` y `CRON_SECRET`. Los correos salen en menos de un minuto.

> Gmail permite unos 500 destinatarios al día, suficiente para un laboratorio. Si algún día no alcanza,
> basta cambiar los secretos SMTP por los de Brevo u otro proveedor.

### 3. GitHub Pages
1. Sube `config.js` con tus datos (la *anon key* es pública por diseño; la seguridad la dan las reglas RLS).
2. **Settings → Pages → Build and deployment**: *Deploy from a branch*, rama `main`, carpeta `/ (root)`.

### 4. Tu cuenta de administrador
1. Entra a la página, regístrate y confirma tu correo.
2. En el SQL Editor de Supabase ejecuta (con tu correo y la dirección real del sitio):
   ```sql
   update public.profiles set is_admin = true, status = 'activo' where email = 'tu-correo@ejemplo.mx';
   update public.settings set site_url = 'https://aluna-lab.github.io/Raman-reservas/';
   ```
3. Recarga la página: aparecerá la pestaña **Administración**.

## Uso diario

- **Usuarios**: se registran, confirman su correo y esperan la aprobación. En la **Agenda** tocan un espacio libre
  para reservar y tocan su propia reserva para cancelarla o, si ya terminaron, liberar el resto.
- **Responsable**: en **Administración** aprueba o rechaza registros, da de baja usuarios (sus reservas futuras se
  cancelan y se avisa del hueco), aprueba series de experimentos, cancela cualquier reserva y ajusta las reglas.
  Las reservas del administrador no tienen límites (útil para mantenimiento o calibración).

## Pruebas de las reglas

`tests/` permite probar `schema.sql` en un PostgreSQL local (≥14) sin Supabase:

```bash
createdb rt && psql -d rt -f tests/stub_auth.sql -f supabase/schema.sql
psql -d rt -f tests/run_tests.sql
```

Cada línea muestra `OK` o el mensaje de error que vería el usuario.
