import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
css = (root/"styles.css").read_text()
# Tema: el visor exige los tres estados (sistema, claro, oscuro explícito).
m = re.search(r"@media \(prefers-color-scheme: dark\) \{\s*:root \{(.*?)\}\s*\}", css, re.S)
dark = m.group(1)
css = css.replace(m.group(0),
  "@media (prefers-color-scheme: dark) { :root:not([data-theme=\"light\"]) {" + dark + " color-scheme: dark; } }\n"
  ":root[data-theme=\"dark\"] {" + dark + " color-scheme: dark; }")
css = css.replace("main { max-width: 1100px; margin: 0 auto; padding: 16px; }",
  "main { max-width: 1100px; margin: 0 auto; padding-block: 16px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }")
css = css.replace("padding: 12px 16px; background: var(--card);",
  "padding-block: 12px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); background: var(--card);")
css += """
.demo { background: var(--accent); color: var(--accent-ink); padding-block: 10px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
  display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; justify-content: space-between; font-size: .9rem; }
.demo .sw { display: flex; gap: 6px; flex-wrap: wrap; }
.demo button { background: transparent; color: var(--accent-ink); border-color: var(--accent-ink); padding: 5px 10px; }
.demo button[aria-pressed="true"] { background: var(--accent-ink); color: var(--accent); }
#logout { display: none; }
.demo.estilos { background: #111; color: #fff; font-family: system-ui, sans-serif; font-size: .9rem; }
.demo.estilos button { font: 600 .85rem system-ui, sans-serif !important; text-transform: none !important; color: #fff !important; border: 1px solid #fff !important;
  background: transparent !important; box-shadow: none !important; border-radius: 6px !important; transform: none !important; animation: none !important; padding: 5px 10px !important; }
.demo.estilos button::before { content: none !important; }
.demo.estilos button[aria-pressed="true"] { background: #fff !important; color: #111 !important; }
button:focus-visible, a:focus-visible, td.free:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
"""
html = (root/"index.html").read_text()
body = html.split("<body>")[1].split("<script")[0]
app = (root/"app.js").read_text()
app = re.sub(r"^import .*?;\n", "", app, flags=re.M)
app = app.replace("const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);", "const sb = DEMO.client;")
mock = (root/"demo/mock-backend.js").read_text()
# Estilos del mes: en la demo se pueden cambiar con botones. ":root:not(#_)" les da prioridad sobre el modo oscuro de la demo.
import json
temas = {f.stem: f.read_text().replace(":root", ":root:not(#_)") for f in sorted((root/"temas").glob("*.css"))}
calendario = (root/"temas/tema.js").read_text().split("(function")[0]
skin_js = calendario + "const TEMAS = " + json.dumps(temas, ensure_ascii=False) + """;
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
document.querySelector(".estilos .sw").innerHTML = Object.entries(ESTILO_POR_MES)
  .map(([m, k]) => `<button data-estilo="${k}" aria-pressed="false">${MESES[m - 1]} · ${k}</button>`).join("")
  + '<button data-estilo="clasico" aria-pressed="false">clásico</button>';
function ponerEstilo(k) {
  document.getElementById("estilo").textContent = TEMAS[k] || "";
  document.querySelectorAll(".estilos button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.estilo === k));
}
document.querySelectorAll(".estilos button").forEach((b) => b.onclick = () => ponerEstilo(b.dataset.estilo));
ponerEstilo(new URLSearchParams(location.search).get("estilo") || ESTILO_POR_MES[new Date().getMonth() + 1]);
"""
out = f"""<title>Reservas Raman RMS1000</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
{css}
</style>
<style id="estilo"></style>
<div class="demo estilos" role="region" aria-label="Estilo">
  <span><strong>Estilo del mes:</strong> cambia solo; aquí puedes probarlos todos.</span>
  <span class="sw"></span>
</div>
<div class="demo" role="region" aria-label="Demostración">
  <span><strong>Demo con datos de ejemplo.</strong> Nada se guarda ni se envían correos.</span>
  <span class="sw">Ver como:
    <button id="as-adm" aria-pressed="true">Responsable</button>
    <button id="as-est" aria-pressed="false">Estudiante</button>
    <button id="as-u5" aria-pressed="false">Usuario pendiente</button></span>
</div>
{body}
<script>
{skin_js}
</script>
<script type="module">
window.confirm = () => true;
window.prompt = () => "";
{mock}
for (const id of ["adm", "est", "u5"]) document.getElementById("as-" + id).onclick = () => {{
  document.querySelectorAll(".demo button").forEach((b) => b.setAttribute("aria-pressed", b.id === "as-" + id));
  if (location.hash === "#admin" && id !== "adm") location.hash = "#agenda";
  DEMO.switchUser(id);
}};
{app}
</script>
"""
pathlib.Path(__file__).with_name("demo.html").write_text(out)
print(len(out))
