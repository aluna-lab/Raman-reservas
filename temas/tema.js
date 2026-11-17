// ===== Estilo del mes =====
// Aquí decides qué diseño se ve cada mes. Solo cambia el nombre entre comillas.
// Estilos disponibles (cada uno es un archivo en esta carpeta):
//   halloween, muertos, navidad, electrico, manga, arcade, primavera,
//   espectro, oceano, espacio, comic, patrias  y  "clasico" (el diseño sobrio original).
const ESTILO_POR_MES = {
  1: "electrico",   // enero      ⚡ ratoncito eléctrico
  2: "manga",       // febrero    ✦ manga
  3: "arcade",      // marzo      👾 videojuego retro
  4: "primavera",   // abril      🌸 primavera
  5: "espectro",    // mayo       🌈 arcoíris láser
  6: "oceano",      // junio      🐠 océano
  7: "espacio",     // julio      🪐 espacio
  8: "comic",       // agosto     💥 cómic
  9: "patrias",     // septiembre 🎉 fiestas patrias
  10: "halloween",  // octubre    🎃 Halloween
  11: "muertos",    // noviembre  💀 Día de Muertos
  12: "navidad",    // diciembre  🎄 Navidad
};

// Para probar un estilo sin esperar al mes, agrega ?estilo=nombre a la dirección,
// por ejemplo: https://aluna-lab.github.io/Raman-reservas/?estilo=navidad
(function () {
  const pedido = new URLSearchParams(location.search).get("estilo");
  const estilo = pedido || ESTILO_POR_MES[new Date().getMonth() + 1] || "clasico";
  if (!/^[a-z]+$/.test(estilo) || estilo === "clasico") return; // "clasico" = sin estilo extra
  document.documentElement.dataset.estilo = estilo;
  document.write('<link rel="stylesheet" href="temas/' + estilo + '.css">');
})();
