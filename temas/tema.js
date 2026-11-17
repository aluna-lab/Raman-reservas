// ===== Estilo del mes =====
// Aquí decides qué diseño se ve cada mes. Solo cambia el nombre entre comillas.
// Estilos disponibles: "espectro", "electrico", "arcade", "comic" y "clasico" (el diseño sobrio original).
const ESTILO_POR_MES = {
  1: "arcade",      // enero
  2: "comic",       // febrero
  3: "espectro",    // marzo
  4: "electrico",   // abril
  5: "arcade",      // mayo
  6: "comic",       // junio
  7: "espectro",    // julio
  8: "electrico",   // agosto
  9: "arcade",      // septiembre
  10: "comic",      // octubre
  11: "espectro",   // noviembre
  12: "electrico",  // diciembre
};

// Para probar un estilo sin esperar al mes, agrega ?estilo=nombre a la dirección,
// por ejemplo: https://aluna-lab.github.io/Raman-reservas/?estilo=electrico
(function () {
  const pedido = new URLSearchParams(location.search).get("estilo");
  const estilo = pedido || ESTILO_POR_MES[new Date().getMonth() + 1] || "clasico";
  if (!/^(espectro|electrico|arcade|comic)$/.test(estilo)) return; // "clasico" = sin estilo extra
  document.documentElement.dataset.estilo = estilo;
  document.write('<link rel="stylesheet" href="temas/' + estilo + '.css">');
})();
