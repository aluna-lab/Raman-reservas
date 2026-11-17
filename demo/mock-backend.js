// Backend simulado en memoria para la demo (imita Supabase y las reglas de schema.sql).
const DEMO = (() => {
  const now = new Date();
  const at = (dayOffset, h, m = 0) => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + dayOffset); d.setHours(h, m); return d; };
  // Próximo día hábil a partir de hoy + n
  const wd = (n, h, m = 0) => { let d = 0, c = -1; while (true) { const x = at(d, 0); const w = x.getDay(); if (w !== 0 && w !== 6) c++; if (c >= n) return at(d, h, m); d++; } };
  const iso = (d) => d.toISOString();
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const db = {
    settings: [{ id: 1, instrument_name: "Microscopio Raman RMS1000", max_days_ahead: 14, max_future_hours: 8, max_block_hours: 4,
      slot_minutes: 30, open_hour: 0, close_hour: 24, allow_weekends: false, freed_notice_hours: 72, site_url: "https://aluna-lab.github.io/Raman-reservas/" }],
    profiles: [
      { id: "adm", avatar: "🔬", email: "responsable@cfata.unam.mx", full_name: "Andrés (responsable)", program: "CFATA", advisor_name: "—", advisor_email: "responsable@cfata.unam.mx", status: "activo", is_admin: true, notify_freed: true, created_at: iso(at(-60, 9)) },
      { id: "est", avatar: "🦊", email: "mariana.lopez@posgrado.unam.mx", full_name: "Mariana López", program: "Maestría en Ciencia e Ingeniería de Materiales", advisor_name: "Dra. Elena Ríos", advisor_email: "erios@fata.unam.mx", status: "activo", is_admin: false, notify_freed: true, created_at: iso(at(-30, 9)) },
      { id: "u3", avatar: "🚀", email: "jorge.vega@posgrado.unam.mx", full_name: "Jorge Vega", program: "Doctorado en Ciencias Físicas", advisor_name: "Dr. Luis Prado", advisor_email: "lprado@fata.unam.mx", status: "activo", is_admin: false, notify_freed: true, created_at: iso(at(-40, 9)) },
      { id: "u4", email: "sofia.mena@posgrado.unam.mx", full_name: "Sofía Mena", program: "Doctorado en Ingeniería", advisor_name: "Dr. Raúl Ortega", advisor_email: "rortega@fata.unam.mx", status: "activo", is_admin: false, notify_freed: true, created_at: iso(at(-20, 9)) },
      { id: "u5", email: "diego.cruz@posgrado.unam.mx", full_name: "Diego Cruz", program: "Licenciatura en Tecnología", advisor_name: "Dra. Elena Ríos", advisor_email: "erios@fata.unam.mx", status: "pendiente", is_admin: false, notify_freed: true, created_at: iso(at(-1, 18)) },
      { id: "u6", email: "paola.sanz@posgrado.unam.mx", full_name: "Paola Sanz", program: "Maestría en Ciencias Químicas", advisor_name: "Dr. Iván Gil", advisor_email: "igil@fata.unam.mx", status: "pendiente", is_admin: false, notify_freed: true, created_at: iso(at(0, 10)) },
    ],
    exception_requests: [
      { id: 1, user_id: "u3", starts_on: ymd(wd(5, 0)), ends_on: ymd(wd(14, 0)), max_hours: 30, reason: "Mapeos Raman de 10 muestras de grafeno dopado para artículo; ~3 h por mapeo", status: "pendiente", admin_note: null, created_at: iso(at(0, 9)) },
      { id: 2, user_id: "est", starts_on: ymd(wd(1, 0)), ends_on: ymd(wd(8, 0)), max_hours: 16, reason: "Serie de cinética de cristalización (mediciones cada 24 h)", status: "aprobada", admin_note: "Adelante", created_at: iso(at(-3, 9)) },
    ],
    bookings: [],
    email_outbox: [],
  };
  let nextId = 100;
  const B = (user_id, s, e, note, exception_id = null) => db.bookings.push({ id: nextId++, user_id, starts_at: iso(s), ends_at: iso(e), note, exception_id, status: "activa", created_at: iso(now) });
  B("est", wd(0, 10), wd(0, 12), "Muestras TiO2, láser 532 nm");
  B("u3", wd(0, 13), wd(0, 17), "Calibración + espectros puntuales");
  B("u4", wd(1, 9), wd(1, 11, 30), "Polímeros, 785 nm");
  B("u3", wd(1, 22), wd(2, 2), "Mapeo nocturno");
  B("est", wd(2, 16), wd(2, 18), "Repetición de espectros");
  B("u4", wd(3, 10), wd(3, 14), null);
  B("adm", wd(4, 8), wd(4, 10), "Mantenimiento y limpieza de objetivos");
  B("u3", wd(-1, 10), wd(-1, 12), null);

  let uid = "adm";
  const authCbs = [];
  const prof = (id) => db.profiles.find((p) => p.id === id);
  const cfg = () => db.settings[0];
  const H = (a, b) => (new Date(b) - new Date(a)) / 3.6e6;
  const fail = (message) => ({ data: null, error: { message } });
  const mail = (to, subject) => db.email_outbox.push({ to, subject, at: new Date() });

  function view(table) {
    if (table === "agenda") {
      const me = prof(uid);
      if (!(me.status === "activo" || me.is_admin)) return [];
      return db.bookings.filter((b) => b.status === "activa").map((b) => ({ ...b, full_name: prof(b.user_id).full_name, advisor_name: prof(b.user_id).advisor_name, avatar: prof(b.user_id).avatar ?? null, mine: b.user_id === uid }));
    }
    if (table === "bookings") return db.bookings.filter((b) => b.user_id === uid || prof(uid).is_admin).map((b) => ({ ...b, exception_requests: b.exception_id ? { reason: db.exception_requests.find((x) => x.id === b.exception_id)?.reason } : null }));
    if (table === "exception_requests") return db.exception_requests.filter((x) => x.user_id === uid || prof(uid).is_admin).map((x) => ({ ...x, profiles: { full_name: prof(x.user_id).full_name, advisor_name: prof(x.user_id).advisor_name, avatar: prof(x.user_id).avatar ?? null } }));
    if (table === "profiles") return db.profiles.filter((p) => p.id === uid || prof(uid).is_admin);
    return db[table] || [];
  }

  function validate(b) {
    const me = prof(uid), c = cfg();
    const s = new Date(b.starts_at), e = new Date(b.ends_at);
    if (db.bookings.some((x) => x.status === "activa" && new Date(x.starts_at) < e && s < new Date(x.ends_at))) return "Ese horario ya está ocupado.";
    if (me.is_admin) return null;
    if (me.status !== "activo") return "Tu cuenta no está activa. Espera la aprobación del responsable.";
    if (s < new Date(Date.now() - 3e5)) return "No se puede reservar en el pasado.";
    if (!c.allow_weekends && [0, 6].includes(s.getDay())) return "No se reserva en fin de semana.";
    const dur = H(s, e);
    if (b.exception_id) {
      const x = db.exception_requests.find((r) => r.id === b.exception_id);
      if (!x || x.status !== "aprobada" || x.user_id !== uid) return "La solicitud de serie no existe o no está aprobada.";
      if (ymd(s) < x.starts_on || ymd(s) > x.ends_on) return `La reserva está fuera del periodo aprobado (${x.starts_on} a ${x.ends_on}).`;
      const used = db.bookings.filter((y) => y.exception_id === x.id && y.status === "activa").reduce((a, y) => a + H(y.starts_at, y.ends_at), 0);
      if (used + dur > x.max_hours) return `La serie aprobada permite ${x.max_hours} h; ya llevas ${used} h reservadas.`;
      return null;
    }
    if (s > new Date(Date.now() + c.max_days_ahead * 864e5)) return `Sólo se puede reservar con ${c.max_days_ahead} días de anticipación como máximo. Para una serie larga de experimentos, envía una solicitud de serie.`;
    if (dur > c.max_block_hours) return `Una sesión puede durar como máximo ${c.max_block_hours} h.`;
    const used = db.bookings.filter((y) => y.user_id === uid && y.status === "activa" && !y.exception_id && new Date(y.ends_at) > new Date())
      .reduce((a, y) => a + H(Math.max(new Date(y.starts_at), new Date()), y.ends_at), 0);
    if (used + dur > c.max_future_hours) return `Límite de ${c.max_future_hours} h reservadas a futuro (ya tienes ${Math.round(used * 10) / 10} h). Cuando uses o liberes alguna, podrás reservar más.`;
    return null;
  }

  function query(table) {
    const filters = []; let order = null, lim = null, op = "select", payload = null;
    const api = {
      select() { return api; },
      eq(k, v) { filters.push((r) => r[k] === v); return api; },
      is(k, v) { filters.push((r) => (r[k] ?? null) === v); return api; },
      gt(k, v) { filters.push((r) => r[k] > v); return api; },
      gte(k, v) { filters.push((r) => r[k] >= v); return api; },
      lt(k, v) { filters.push((r) => r[k] < v); return api; },
      order(k, o = {}) { order = [k, o.ascending !== false]; return api; },
      limit(n) { lim = n; return api; },
      insert(row) { op = "insert"; payload = row; return api; },
      update(row) { op = "update"; payload = row; return api; },
      single() { return api.then((r) => ({ ...r, data: r.data?.[0] ?? null })); },
      maybeSingle() { return api.single(); },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    function run() {
      if (op === "insert") {
        if (table === "bookings") {
          const err = validate(payload); if (err) return fail(err);
          const b = { id: nextId++, status: "activa", created_at: iso(new Date()), ...payload };
          db.bookings.push(b); mail(prof(b.user_id).advisor_email, "Reserva nueva"); return { data: [b], error: null };
        }
        if (table === "exception_requests") {
          db.exception_requests.push({ id: nextId++, status: "pendiente", created_at: iso(new Date()), admin_note: null, ...payload, user_id: uid });
          return { data: null, error: null };
        }
      }
      if (op === "update") {
        const rows = (db[table] || []).filter((r) => filters.every((f) => f(r)));
        if (table === "profiles" && rows.some((r) => r.id !== uid)) return fail("Sin permiso.");
        if (table === "settings" && !prof(uid).is_admin) return fail("Sin permiso.");
        rows.forEach((r) => Object.assign(r, payload));
        return { data: rows, error: null };
      }
      let rows = view(table).filter((r) => filters.every((f) => f(r)));
      if (order) rows.sort((a, b) => (a[order[0]] > b[order[0]] ? 1 : -1) * (order[1] ? 1 : -1));
      if (lim) rows = rows.slice(0, lim);
      return { data: rows, error: null };
    }
    return api;
  }

  async function rpc(fn, a) {
    const me = prof(uid);
    if (fn === "cancel_booking") {
      const b = db.bookings.find((x) => x.id === a.p_id);
      if (!b || b.status !== "activa" || (b.user_id !== uid && !me.is_admin)) return fail("Reserva no encontrada.");
      if (new Date(b.starts_at) > new Date()) { b.status = "cancelada"; mail("todos", "Horario disponible"); return { data: "Reserva cancelada. Se avisó al asesor(a) y a los demás usuarios.", error: null }; }
      const slot = cfg().slot_minutes * 6e4; const cut = new Date(Math.ceil(Date.now() / slot) * slot);
      if (cut >= new Date(b.ends_at)) return { data: "La sesión ya está por terminar; no hay tiempo que liberar.", error: null };
      b.ends_at = iso(cut); return { data: "Tiempo restante liberado. Se avisó a los demás usuarios.", error: null };
    }
    if (!me.is_admin) return fail("Sólo el administrador.");
    if (fn === "admin_set_user_status") {
      const p = prof(a.p_user); p.status = a.p_status;
      if (a.p_status === "baja") db.bookings.filter((b) => b.user_id === p.id && b.status === "activa" && new Date(b.starts_at) > new Date()).forEach((b) => (b.status = "cancelada"));
      return { data: null, error: null };
    }
    if (fn === "admin_decide_exception") {
      const x = db.exception_requests.find((r) => r.id === a.p_id); x.status = a.p_approve ? "aprobada" : "rechazada"; x.admin_note = a.p_note || null;
      return { data: null, error: null };
    }
    return fail("Función desconocida");
  }

  const client = {
    from: query, rpc,
    auth: {
      getSession: async () => ({ data: { session: { user: { id: uid } } } }),
      onAuthStateChange: (cb) => authCbs.push(cb),
      signOut: async () => ({}), signInWithPassword: async () => ({}), signUp: async () => ({ data: {} }),
      resetPasswordForEmail: async () => ({}), updateUser: async () => ({}),
    },
  };
  return {
    client,
    switchUser(id) { uid = id; authCbs.forEach((cb) => cb("SIGNED_IN")); },
    get user() { return uid; },
  };
})();
