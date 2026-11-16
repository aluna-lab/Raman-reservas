import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const app = document.getElementById("app");
const dlg = document.getElementById("dlg");
const dlgForm = document.getElementById("dlg-form");

const S = { session: null, profile: null, cfg: null, weekOffset: 0, recovering: false };

// ---------------------------------------------------------------- utilidades
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const h = (strings, ...vals) => strings.reduce((a, s, i) => a + s + (i < vals.length ? vals[i] : ""), "");
const pad = (n) => String(n).padStart(2, "0");
const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDay = (d) => d.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
const fmtDate = (d) => d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
const fmtRange = (a, b) => `${fmtDate(a)}, ${fmtTime(a)}–${fmtTime(b)}${isoDate(a) !== isoDate(b) && !(b.getHours() === 0 && b.getMinutes() === 0 && b - a <= 864e5) ? ` del ${fmtDay(b)}` : ""}`;
const hours = (a, b) => (b - a) / 3.6e6;
const fmtH = (x) => (Math.round(x * 10) / 10).toString().replace(".0", "") + " h";
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const errMsg = (e) => (e?.message || String(e)).replace(/^.*?ERROR:\s*/, "")
  .replace(/conflicting key value violates exclusion constraint.*/, "Ese horario ya está ocupado.");

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 3500);
}

function openDialog(html, onSubmit) {
  dlgForm.innerHTML = html;
  dlgForm.onsubmit = async (ev) => {
    const btn = ev.submitter;
    if (!btn || btn.value === "cancel") return;           // cerrar sin hacer nada
    ev.preventDefault();
    btn.disabled = true;
    const out = dlgForm.querySelector(".err");
    try {
      const done = await onSubmit(btn.value, new FormData(dlgForm));
      if (done !== false) dlg.close();
    } catch (e) {
      if (out) out.textContent = errMsg(e); else toast(errMsg(e));
    } finally { btn.disabled = false; }
  };
  dlg.showModal();
}

function startOfWeek(offset) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // lunes = 0
  // En fin de semana (si no se reserva sábado/domingo) muestra la semana siguiente.
  const skip = !S.cfg?.allow_weekends && dow >= 5 ? 1 : 0;
  d.setDate(d.getDate() - dow + (offset + skip) * 7);
  return d;
}

// ---------------------------------------------------------------- arranque
async function loadContext() {
  const { data: { session } } = await sb.auth.getSession();
  S.session = session;
  S.profile = null;
  if (session) {
    const [{ data: prof }, { data: cfg }] = await Promise.all([
      sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle(),
      sb.from("settings").select("*").eq("id", 1).single(),
    ]);
    S.profile = prof; S.cfg = cfg;
  }
  const active = S.profile && (S.profile.status === "activo" || S.profile.is_admin);
  document.getElementById("nav").hidden = !active;
  document.getElementById("nav-admin").hidden = !S.profile?.is_admin;
}

async function route() {
  if (S.recovering) return viewNewPassword();
  if (!S.session) return location.hash === "#registro" ? viewRegister() : location.hash === "#recuperar" ? viewForgot() : viewLogin();
  if (!S.profile) return viewMessage("No se encontró tu perfil.", "Contacta al responsable del equipo.");
  if (S.profile.status === "pendiente" && !S.profile.is_admin)
    return viewMessage("Tu registro está pendiente de aprobación",
      "El responsable del equipo revisará tu solicitud. Recibirás un correo cuando tu cuenta esté activa.");
  if (S.profile.status === "baja" && !S.profile.is_admin)
    return viewMessage("Tu cuenta está dada de baja", "Si necesitas volver a usar el equipo, contacta al responsable.");

  const r = location.hash.replace("#", "") || "agenda";
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + r));
  const views = { agenda: viewAgenda, mis: viewMine, serie: viewSeries, perfil: viewProfile, admin: viewAdmin };
  return (views[r] || viewAgenda)();
}

sb.auth.onAuthStateChange(async (event) => {
  if (event === "PASSWORD_RECOVERY") S.recovering = true;
  if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "PASSWORD_RECOVERY") {
    await loadContext(); route();
  }
});
window.addEventListener("hashchange", route);
document.getElementById("logout").onclick = async () => { await sb.auth.signOut(); location.hash = ""; };

await loadContext();
route();

// ---------------------------------------------------------------- acceso
function viewMessage(title, text) {
  app.innerHTML = h`<div class="card narrow"><h1>${esc(title)}</h1><p>${esc(text)}</p>
    <button class="secondary" id="out">Salir</button></div>`;
  document.getElementById("out").onclick = () => sb.auth.signOut();
}

function viewLogin() {
  app.innerHTML = h`<div class="card narrow">
    <h1>Entrar</h1>
    <form id="f">
      <label>Correo</label><input name="email" type="email" required autocomplete="email">
      <label>Contraseña</label><input name="password" type="password" required autocomplete="current-password">
      <div class="err"></div>
      <div class="row" style="margin-top:12px"><button>Entrar</button>
        <a href="#recuperar" class="small">Olvidé mi contraseña</a></div>
    </form>
    <p class="small muted" style="margin-top:18px">¿Primera vez? <a href="#registro">Regístrate aquí</a>. El responsable del equipo aprobará tu cuenta.</p>
  </div>`;
  const f = document.getElementById("f");
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const { error } = await sb.auth.signInWithPassword({ email: fd.get("email").trim(), password: fd.get("password") });
    if (error) f.querySelector(".err").textContent =
      error.message.includes("Invalid login") ? "Correo o contraseña incorrectos." :
      error.message.includes("not confirmed") ? "Primero confirma tu correo con el enlace que te enviamos." : error.message;
  };
}

function viewRegister() {
  app.innerHTML = h`<div class="card narrow">
    <h1>Registro de usuario</h1>
    <p class="small muted">Tu cuenta quedará pendiente hasta que el responsable la apruebe. Cada reserva se notificará por correo a tu asesor(a) principal.</p>
    <form id="f">
      <label>Nombre completo</label><input name="full_name" required>
      <label>Correo institucional</label><input name="email" type="email" required autocomplete="email">
      <label>Contraseña (mínimo 8 caracteres)</label><input name="password" type="password" minlength="8" required autocomplete="new-password">
      <label>Programa / adscripción</label><input name="program" placeholder="p. ej. Doctorado en Ciencia e Ingeniería de Materiales">
      <label>Nombre del asesor(a) principal</label><input name="advisor_name" required>
      <label>Correo del asesor(a) principal</label><input name="advisor_email" type="email" required>
      <div class="err"></div>
      <div class="row" style="margin-top:12px"><button>Enviar registro</button><a href="#" class="small">Ya tengo cuenta</a></div>
    </form></div>`;
  const f = document.getElementById("f");
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(f));
    const btn = f.querySelector("button"); btn.disabled = true;
    const { data, error } = await sb.auth.signUp({
      email: fd.email.trim(), password: fd.password,
      options: {
        emailRedirectTo: location.origin + location.pathname,
        data: { full_name: fd.full_name.trim(), program: fd.program.trim(),
                advisor_name: fd.advisor_name.trim(), advisor_email: fd.advisor_email.trim() },
      },
    });
    btn.disabled = false;
    if (error) { f.querySelector(".err").textContent = error.message; return; }
    if (!data.session) viewMessage("Revisa tu correo",
      "Te enviamos un enlace para confirmar tu correo. Después, el responsable aprobará tu cuenta.");
  };
}

function viewForgot() {
  app.innerHTML = h`<div class="card narrow"><h1>Recuperar contraseña</h1>
    <form id="f"><label>Correo</label><input name="email" type="email" required>
    <div class="err"></div><div class="row" style="margin-top:12px"><button>Enviar enlace</button><a href="#" class="small">Volver</a></div></form></div>`;
  const f = document.getElementById("f");
  f.onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.resetPasswordForEmail(new FormData(f).get("email").trim(),
      { redirectTo: location.origin + location.pathname });
    if (error) f.querySelector(".err").textContent = error.message;
    else viewMessage("Revisa tu correo", "Te enviamos un enlace para cambiar tu contraseña.");
  };
}

function viewNewPassword() {
  app.innerHTML = h`<div class="card narrow"><h1>Nueva contraseña</h1>
    <form id="f"><label>Contraseña nueva</label><input name="p" type="password" minlength="8" required>
    <div class="err"></div><button style="margin-top:12px">Guardar</button></form></div>`;
  const f = document.getElementById("f");
  f.onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: new FormData(f).get("p") });
    if (error) { f.querySelector(".err").textContent = error.message; return; }
    S.recovering = false; toast("Contraseña actualizada."); location.hash = "#agenda"; route();
  };
}

// ---------------------------------------------------------------- agenda
async function myFutureHours() {
  const { data } = await sb.from("bookings").select("starts_at,ends_at")
    .eq("user_id", S.profile.id).eq("status", "activa").is("exception_id", null).gt("ends_at", new Date().toISOString());
  const now = new Date();
  return (data || []).reduce((a, b) => a + hours(Math.max(now, new Date(b.starts_at)), new Date(b.ends_at)), 0);
}

async function myApprovedSeries() {
  const { data } = await sb.from("exception_requests").select("*")
    .eq("user_id", S.profile.id).eq("status", "aprobada").gte("ends_on", isoDate(new Date())).order("starts_on");
  return data || [];
}

async function viewAgenda() {
  const cfg = S.cfg;
  const ws = startOfWeek(S.weekOffset);
  const nDays = cfg.allow_weekends ? 7 : 5;
  const we = new Date(ws); we.setDate(we.getDate() + 7);
  const [{ data: rows, error }, used] = await Promise.all([
    sb.from("agenda").select("*").lt("starts_at", we.toISOString()).gt("ends_at", ws.toISOString()).order("starts_at"),
    myFutureHours(),
  ]);
  if (error) { app.innerHTML = `<p class="err">${esc(error.message)}</p>`; return; }
  const bookings = rows.map((b) => ({ ...b, s: new Date(b.starts_at), e: new Date(b.ends_at) }));
  const slot = cfg.slot_minutes, now = new Date();
  const limit = new Date(now.getTime() + cfg.max_days_ahead * 864e5);
  const today = isoDate(now);

  let head = `<tr><th class="time"></th>`;
  const days = [];
  for (let i = 0; i < nDays; i++) {
    const d = new Date(ws); d.setDate(d.getDate() + i); days.push(d);
    head += `<th class="${isoDate(d) === today ? "today" : ""}">${esc(fmtDay(d))}</th>`;
  }
  head += `</tr>`;

  let body = "";
  for (let m = cfg.open_hour * 60; m < cfg.close_hour * 60; m += slot) {
    body += `<tr><td class="time">${m % 60 === 0 ? `${pad(m / 60)}:00` : ""}</td>`;
    for (const d of days) {
      const t = new Date(d); t.setMinutes(m);
      const b = bookings.find((x) => x.s <= t && t < x.e);
      if (b) {
        const first = b.s.getTime() === t.getTime() || m === cfg.open_hour * 60;
        const cls = ["busy", b.mine ? "mine" : "", b.exception_id ? "series" : "", S.profile.is_admin && !b.mine ? "admin-click" : ""].join(" ");
        body += `<td class="${cls}" data-b="${b.id}" title="${esc(b.full_name)} · ${fmtTime(b.s)}–${fmtTime(b.e)}">${first ? `<span class="lbl">${esc(b.mine ? "Tú" : b.full_name)}</span>` : ""}</td>`;
      } else if (t < new Date(now.getTime() - slot * 6e4)) {
        body += `<td class="past"></td>`;
      } else {
        body += `<td class="free" data-t="${t.getTime()}"></td>`;
      }
    }
    body += `</tr>`;
  }

  const pct = Math.min(100, (used / cfg.max_future_hours) * 100);
  app.innerHTML = h`
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <div><strong>Tus horas reservadas a futuro:</strong> ${fmtH(used)} de ${fmtH(cfg.max_future_hours)}
          <div class="meter" style="width:220px"><div style="width:${pct}%"></div></div></div>
        <div class="small muted">Sesiones de hasta ${fmtH(cfg.max_block_hours)} · hasta ${cfg.max_days_ahead} días de anticipación ·
          <a href="#serie">¿necesitas más? solicita una serie</a></div>
      </div>
    </div>
    <div class="week-head">
      <div class="row"><button class="secondary" id="prev">‹</button><button class="secondary" id="hoy">Hoy</button><button class="secondary" id="next">›</button></div>
      <strong>Semana del ${esc(ws.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }))}</strong>
    </div>
    <div class="cal-wrap" id="calwrap"><table class="cal"><thead>${head}</thead><tbody>${body}</tbody></table></div>
    <div class="legend"><span><i style="background:var(--mine)"></i>Tus reservas</span><span><i style="background:var(--busy)"></i>Ocupado</span>
      <span><i style="background:var(--busy);box-shadow:inset 3px 0 var(--ser)"></i>Serie de experimentos</span>
      <span>Toca un espacio libre para reservar.</span></div>`;

  // Con agenda de 24 h, abre la vista a las 8:00 (se puede desplazar hacia arriba/abajo).
  const row8 = app.querySelectorAll(".cal tbody tr")[Math.max(0, (8 - cfg.open_hour) * 60 / slot)];
  const wrap = document.getElementById("calwrap");
  if (row8 && wrap.scrollHeight > wrap.clientHeight) wrap.scrollTop = row8.offsetTop - 40;
  document.getElementById("prev").onclick = () => { S.weekOffset--; viewAgenda(); };
  document.getElementById("next").onclick = () => { S.weekOffset++; viewAgenda(); };
  document.getElementById("hoy").onclick = () => { S.weekOffset = 0; viewAgenda(); };
  app.querySelectorAll("td.free").forEach((td) => td.onclick = () => bookDialog(new Date(+td.dataset.t), bookings, limit));
  app.querySelectorAll("td.busy.mine, td.busy.admin-click").forEach((td) =>
    td.onclick = () => bookingDialog(bookings.find((b) => b.id === +td.dataset.b)));
}

async function bookDialog(start, bookings, limit) {
  const cfg = S.cfg, slot = cfg.slot_minutes;
  const series = (await myApprovedSeries()).filter((x) => isoDate(start) >= x.starts_on && isoDate(start) <= x.ends_on);
  const fullDay = cfg.open_hour <= 0 && cfg.close_hour >= 24;   // 0–24 h: se puede cruzar la medianoche
  const dayClose = new Date(start); dayClose.setHours(cfg.close_hour, 0, 0, 0);
  const closeMs = fullDay ? Infinity : dayClose.getTime();
  const { data: after } = await sb.from("agenda").select("starts_at").gt("starts_at", start.toISOString()).order("starts_at").limit(1);
  if (after?.length) bookings = [...bookings, { s: new Date(after[0].starts_at) }];
  const nextBusy = bookings.filter((b) => b.s > start).sort((a, b) => a.s - b.s)[0];
  const hardEnd = Math.min(closeMs, nextBusy ? nextBusy.s.getTime() : Infinity);

  const durOptions = (maxH) => {
    let o = "";
    for (let m = slot; m <= maxH * 60 && start.getTime() + m * 6e4 <= hardEnd; m += slot) {
      const e = new Date(start.getTime() + m * 6e4);
      const nextDay = isoDate(e) !== isoDate(start) && !(e.getHours() === 0 && e.getMinutes() === 0) ? " (día siguiente)" : "";
      o += `<option value="${m}" ${m === 120 ? "selected" : ""}>${fmtTime(start)}–${fmtTime(e)}${nextDay} · ${fmtH(m / 60)}</option>`;
    }
    return o || `<option value="">Sin espacio disponible</option>`;
  };
  const tooFar = start > limit && !S.profile.is_admin;

  openDialog(h`
    <h2 style="margin-top:0">Reservar</h2>
    <p>${esc(fmtDate(start))}</p>
    ${series.length ? `<label>Serie de experimentos</label>
      <select name="exc" id="exc"><option value="">Reserva normal</option>
      ${series.map((x) => `<option value="${x.id}" ${tooFar ? "selected" : ""}>Serie aprobada: ${esc(x.reason.slice(0, 40))} (${fmtH(x.max_hours)})</option>`).join("")}</select>` : ""}
    ${tooFar && !series.length ? `<p class="err">Sólo se puede reservar con ${cfg.max_days_ahead} días de anticipación. Si es para una serie de experimentos, <a href="#serie">envía una solicitud</a>.</p>` : ""}
    <label>Horario</label><select name="dur" id="dur">${durOptions(S.profile.is_admin || (tooFar && series.length) ? 24 : cfg.max_block_hours)}</select>
    <label>Nota (opcional)</label><input name="note" maxlength="200" placeholder="Muestra, objetivo, láser…">
    <p class="small muted">Se enviará un aviso a tu asesor(a), ${esc(S.profile.advisor_name)}.</p>
    <div class="err"></div>
    <div class="row" style="margin-top:12px"><button value="ok">Reservar</button><button value="cancel" class="secondary" formnovalidate>Cerrar</button></div>`,
    async (_, fd) => {
      const dur = +fd.get("dur");
      if (!dur) throw new Error("Elige un horario.");
      const { error } = await sb.from("bookings").insert({
        user_id: S.profile.id, starts_at: start.toISOString(),
        ends_at: new Date(start.getTime() + dur * 6e4).toISOString(),
        note: fd.get("note") || null, exception_id: fd.get("exc") ? +fd.get("exc") : null,
      });
      if (error) throw error;
      toast("Reserva hecha. Se avisó a tu asesor(a).");
      viewAgenda();
    });
  const exc = document.getElementById("exc");
  if (exc) exc.onchange = () => {
    document.getElementById("dur").innerHTML = durOptions(exc.value ? 24 : cfg.max_block_hours);
  };
}

function bookingDialog(b) {
  const running = b.s <= new Date();
  openDialog(h`
    <h2 style="margin-top:0">${b.mine ? "Tu reserva" : esc(b.full_name)}</h2>
    <p>${esc(fmtRange(b.s, b.e))}</p>
    ${b.note ? `<p class="muted">${esc(b.note)}</p>` : ""}
    ${!b.mine ? `<p class="small muted">Asesor(a): ${esc(b.advisor_name)}</p>` : ""}
    <p class="small muted">${running ? "Si ya terminaste, libera el tiempo restante para que alguien más lo use." :
      "Si ya no la necesitas, cancélala: se avisará a los demás usuarios que el horario quedó libre."}</p>
    <div class="err"></div>
    <div class="row" style="margin-top:12px">
      <button value="ok" class="danger">${running ? "Terminé, liberar el resto" : "Cancelar reserva"}</button>
      <button value="cancel" class="secondary">Cerrar</button></div>`,
    async () => {
      const { data, error } = await sb.rpc("cancel_booking", { p_id: b.id });
      if (error) throw error;
      toast(data || "Listo.");
      route();
    });
}

// ---------------------------------------------------------------- mis reservas
async function viewMine() {
  const { data, error } = await sb.from("bookings").select("*, exception_requests(reason)")
    .eq("user_id", S.profile.id).order("starts_at", { ascending: false }).limit(60);
  if (error) { app.innerHTML = `<p class="err">${esc(error.message)}</p>`; return; }
  const now = new Date();
  const rows = data.map((b) => ({ ...b, s: new Date(b.starts_at), e: new Date(b.ends_at) }));
  const up = rows.filter((b) => b.status === "activa" && b.e > now).reverse();
  const past = rows.filter((b) => !(b.status === "activa" && b.e > now)).slice(0, 25);
  const line = (b, act) => `<tr><td>${esc(fmtRange(b.s, b.e))}</td><td>${fmtH(hours(b.s, b.e))}</td>
    <td>${b.exception_requests ? `<span class="pill">Serie</span> ` : ""}${esc(b.note || "")}</td>
    <td>${act ? `<button class="secondary" data-id="${b.id}">${b.s <= now ? "Liberar resto" : "Cancelar"}</button>` :
      `<span class="muted small">${b.status === "cancelada" ? "Cancelada" : "Realizada"}</span>`}</td></tr>`;
  app.innerHTML = h`<h1>Mis reservas</h1>
    <div class="card"><h2 style="margin-top:0">Próximas</h2>
    ${up.length ? `<table class="list"><thead><tr><th>Horario</th><th>Duración</th><th>Nota</th><th></th></tr></thead><tbody>${up.map((b) => line(b, true)).join("")}</tbody></table>` : `<p class="muted">No tienes reservas próximas. <a href="#agenda">Ir a la agenda</a>.</p>`}</div>
    <div class="card"><h2 style="margin-top:0">Historial</h2>
    ${past.length ? `<table class="list"><tbody>${past.map((b) => line(b, false)).join("")}</tbody></table>` : `<p class="muted">Sin historial.</p>`}</div>`;
  app.querySelectorAll("button[data-id]").forEach((btn) => btn.onclick = async () => {
    btn.disabled = true;
    const { data: msg, error } = await sb.rpc("cancel_booking", { p_id: +btn.dataset.id });
    toast(error ? errMsg(error) : msg); viewMine();
  });
}

// ---------------------------------------------------------------- series
async function viewSeries() {
  const { data } = await sb.from("exception_requests").select("*").eq("user_id", S.profile.id).order("created_at", { ascending: false });
  app.innerHTML = h`<h1>Serie de experimentos</h1>
    <div class="card">
      <p class="small muted">Si tienes una serie de mediciones importante que requiere más de ${fmtH(S.cfg.max_future_hours)} o reservar con más de ${S.cfg.max_days_ahead} días de anticipación, solicítala aquí. Al aprobarse, podrás reservar dentro de ese periodo sin los límites normales, hasta el total de horas aprobado. Se notificará a tu asesor(a).</p>
      <form id="f">
        <div class="grid2"><div><label>Desde</label><input type="date" name="starts_on" required min="${isoDate(new Date())}"></div>
        <div><label>Hasta</label><input type="date" name="ends_on" required min="${isoDate(new Date())}"></div></div>
        <label>Horas totales que necesitas</label><input type="number" name="max_hours" min="1" max="200" step="0.5" required>
        <label>Motivo (una o dos líneas)</label><textarea name="reason" required maxlength="500" placeholder="p. ej. Serie de mapeos Raman de 12 muestras para artículo; cada mapeo toma ~3 h"></textarea>
        <div class="err"></div><button style="margin-top:12px">Enviar solicitud</button>
      </form></div>
    <div class="card"><h2 style="margin-top:0">Mis solicitudes</h2>
    ${data?.length ? `<table class="list"><thead><tr><th>Periodo</th><th>Horas</th><th>Motivo</th><th>Estado</th></tr></thead><tbody>
      ${data.map((x) => `<tr><td>${x.starts_on} a ${x.ends_on}</td><td>${fmtH(x.max_hours)}</td><td>${esc(x.reason)}${x.admin_note ? `<div class="small muted">Comentario: ${esc(x.admin_note)}</div>` : ""}</td>
        <td><span class="pill ${x.status}">${x.status}</span></td></tr>`).join("")}</tbody></table>` : `<p class="muted">Aún no has enviado solicitudes.</p>`}</div>`;
  const f = document.getElementById("f");
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(f));
    if (fd.ends_on < fd.starts_on) { f.querySelector(".err").textContent = "La fecha final debe ser posterior a la inicial."; return; }
    const { error } = await sb.from("exception_requests").insert({ ...fd, user_id: S.profile.id, max_hours: +fd.max_hours });
    if (error) { f.querySelector(".err").textContent = errMsg(error); return; }
    toast("Solicitud enviada."); viewSeries();
  };
}

// ---------------------------------------------------------------- perfil
function viewProfile() {
  const p = S.profile;
  app.innerHTML = h`<h1>Mi perfil</h1><div class="card narrow" style="margin:0">
    <form id="f">
      <p class="small muted">${esc(p.email)}</p>
      <label>Nombre completo</label><input name="full_name" value="${esc(p.full_name)}" required>
      <label>Programa / adscripción</label><input name="program" value="${esc(p.program)}">
      <label>Asesor(a) principal</label><input name="advisor_name" value="${esc(p.advisor_name)}" required>
      <label>Correo del asesor(a)</label><input name="advisor_email" type="email" value="${esc(p.advisor_email)}" required>
      <label class="row" style="margin-top:14px"><input type="checkbox" name="notify_freed" ${p.notify_freed ? "checked" : ""}> Avisarme por correo cuando se libere un horario próximo</label>
      <div class="err"></div><button style="margin-top:12px">Guardar</button>
    </form></div>`;
  const f = document.getElementById("f");
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(f));
    const upd = { full_name: fd.full_name, program: fd.program, advisor_name: fd.advisor_name,
                  advisor_email: fd.advisor_email.toLowerCase(), notify_freed: !!fd.notify_freed };
    const { error } = await sb.from("profiles").update(upd).eq("id", p.id);
    if (error) { f.querySelector(".err").textContent = errMsg(error); return; }
    Object.assign(S.profile, upd); toast("Perfil guardado.");
  };
}

// ---------------------------------------------------------------- administración
async function viewAdmin() {
  if (!S.profile.is_admin) { location.hash = "#agenda"; return; }
  const [{ data: users }, { data: exc }, { data: up }] = await Promise.all([
    sb.from("profiles").select("*").order("created_at", { ascending: false }),
    sb.from("exception_requests").select("*, profiles(full_name, advisor_name)").order("created_at", { ascending: false }).limit(40),
    sb.from("agenda").select("*").gt("ends_at", new Date().toISOString()).order("starts_at").limit(50),
  ]);
  const by = (s) => users.filter((u) => u.status === s);
  const userRow = (u, actions) => `<tr><td><strong>${esc(u.full_name)}</strong>${u.is_admin ? ' <span class="pill">admin</span>' : ""}<div class="small muted">${esc(u.email)}</div></td>
    <td>${esc(u.program || "")}</td><td>${esc(u.advisor_name)}<div class="small muted">${esc(u.advisor_email)}</div></td>
    <td class="row">${actions}</td></tr>`;
  const btn = (id, st, label, cls = "secondary") => `<button class="${cls}" data-u="${id}" data-s="${st}">${label}</button>`;
  const c = S.cfg;

  app.innerHTML = h`<h1>Administración</h1>
    <div class="card"><h2 style="margin-top:0">Registros pendientes (${by("pendiente").length})</h2>
    ${by("pendiente").length ? `<table class="list"><tbody>${by("pendiente").map((u) => userRow(u, btn(u.id, "activo", "Aprobar", "") + btn(u.id, "baja", "Rechazar"))).join("")}</tbody></table>` : `<p class="muted">Nada pendiente.</p>`}</div>

    <div class="card"><h2 style="margin-top:0">Series de experimentos</h2>
    ${exc?.length ? `<table class="list"><thead><tr><th>Usuario</th><th>Periodo</th><th>Horas</th><th>Motivo</th><th></th></tr></thead><tbody>
      ${exc.map((x) => `<tr><td>${esc(x.profiles?.full_name)}<div class="small muted">${esc(x.profiles?.advisor_name)}</div></td><td>${x.starts_on} a ${x.ends_on}</td><td>${fmtH(x.max_hours)}</td><td>${esc(x.reason)}</td>
        <td>${x.status === "pendiente" ? `<div class="row"><button data-x="${x.id}" data-a="1">Aprobar</button><button class="secondary" data-x="${x.id}" data-a="0">Rechazar</button></div>` : `<span class="pill ${x.status}">${x.status}</span>`}</td></tr>`).join("")}
      </tbody></table>` : `<p class="muted">Sin solicitudes.</p>`}</div>

    <div class="card"><h2 style="margin-top:0">Usuarios activos (${by("activo").length})</h2>
    <table class="list"><tbody>${by("activo").map((u) => userRow(u, u.id === S.profile.id ? "" : btn(u.id, "baja", "Dar de baja"))).join("")}</tbody></table>
    ${by("baja").length ? `<details style="margin-top:12px"><summary>Dados de baja (${by("baja").length})</summary>
      <table class="list"><tbody>${by("baja").map((u) => userRow(u, btn(u.id, "activo", "Reactivar"))).join("")}</tbody></table></details>` : ""}</div>

    <div class="card"><h2 style="margin-top:0">Próximas reservas</h2>
    ${up?.length ? `<table class="list"><tbody>${up.map((b) => `<tr><td>${esc(fmtRange(new Date(b.starts_at), new Date(b.ends_at)))}</td><td>${esc(b.full_name)}</td><td>${esc(b.note || "")}</td>
      <td><button class="secondary" data-c="${b.id}">Cancelar</button></td></tr>`).join("")}</tbody></table>` : `<p class="muted">Sin reservas próximas.</p>`}</div>

    <div class="card"><h2 style="margin-top:0">Reglas</h2>
    <form id="cfg"><div class="grid2">
      <div><label>Anticipación máxima (días)</label><input type="number" name="max_days_ahead" min="1" value="${c.max_days_ahead}"></div>
      <div><label>Horas a futuro por usuario</label><input type="number" name="max_future_hours" min="0.5" step="0.5" value="${c.max_future_hours}"></div>
      <div><label>Duración máxima de sesión (h)</label><input type="number" name="max_block_hours" min="0.5" step="0.5" value="${c.max_block_hours}"></div>
      <div><label>Avisar huecos liberados dentro de (h)</label><input type="number" name="freed_notice_hours" min="0" value="${c.freed_notice_hours}"></div>
      <div><label>Hora de apertura</label><input type="number" name="open_hour" min="0" max="23" value="${c.open_hour}"></div>
      <div><label>Hora de cierre</label><input type="number" name="close_hour" min="1" max="24" value="${c.close_hour}"></div>
    </div>
    <label class="row" style="margin-top:12px"><input type="checkbox" name="allow_weekends" ${c.allow_weekends ? "checked" : ""}> Permitir fines de semana</label>
    <label>Dirección del sitio (para los correos)</label><input name="site_url" value="${esc(c.site_url)}">
    <div class="err"></div><button style="margin-top:12px">Guardar reglas</button></form></div>`;

  app.querySelectorAll("button[data-u]").forEach((b) => b.onclick = async () => {
    if (b.dataset.s === "baja" && !confirm("¿Dar de baja a este usuario? Sus reservas futuras se cancelarán.")) return;
    b.disabled = true;
    const { error } = await sb.rpc("admin_set_user_status", { p_user: b.dataset.u, p_status: b.dataset.s });
    toast(error ? errMsg(error) : "Actualizado."); viewAdmin();
  });
  app.querySelectorAll("button[data-x]").forEach((b) => b.onclick = async () => {
    const note = b.dataset.a === "1" ? "" : (prompt("Comentario para el usuario (opcional):") ?? "");
    b.disabled = true;
    const { error } = await sb.rpc("admin_decide_exception", { p_id: +b.dataset.x, p_approve: b.dataset.a === "1", p_note: note });
    toast(error ? errMsg(error) : "Listo."); viewAdmin();
  });
  app.querySelectorAll("button[data-c]").forEach((b) => b.onclick = async () => {
    if (!confirm("¿Cancelar esta reserva? Se avisará al usuario y a su asesor(a).")) return;
    const { error } = await sb.rpc("cancel_booking", { p_id: +b.dataset.c });
    toast(error ? errMsg(error) : "Cancelada."); viewAdmin();
  });
  const f = document.getElementById("cfg");
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(f));
    const upd = { site_url: fd.site_url, allow_weekends: !!fd.allow_weekends };
    for (const k of ["max_days_ahead", "max_future_hours", "max_block_hours", "freed_notice_hours", "open_hour", "close_hour"]) upd[k] = +fd[k];
    const { error } = await sb.from("settings").update(upd).eq("id", 1);
    if (error) { f.querySelector(".err").textContent = errMsg(error); return; }
    Object.assign(S.cfg, upd); toast("Reglas guardadas.");
  };
}
