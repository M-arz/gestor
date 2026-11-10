/**
 * GESTOR · Dashboard: menú derecho + saludo en Inicio
 *
 * Cargar DESPUÉS de app.js y equipos.js.
 * Redefine pintarSesion(): el saludo ahora vive en Inicio (#userGreeting),
 * el nombre va en el menú (#menuUserName) y el botón de 3 rayas solo se
 * muestra con sesión iniciada. El botón #btnLogout queda dentro del menú.
 */
function pintarSesion() {
  const btnLogin = document.getElementById("btnLogin");
  const btnMenu = document.getElementById("btnMenu");
  const greeting = document.getElementById("userGreeting");
  const menuNombre = document.getElementById("menuUserName");
  const btnCrearTorneo = document.getElementById("btnCrearTorneo");
  const btnCrearEquipo = document.getElementById("btnCrearEquipo");
  const esAdmin = Boolean(usuario && usuario.rol === "admin");
  const esDelegado = Boolean(usuario && usuario.rol === "delegado");

  btnLogin.style.display = usuario ? "none" : "inline-block";
  btnMenu.style.display = usuario ? "grid" : "none";
  greeting.textContent = usuario ? `Hola, ${usuario.nombre} (${usuario.rol})` : "";
  menuNombre.textContent = usuario ? usuario.nombre : "";
  btnCrearTorneo.style.display = esAdmin ? "inline-block" : "none";
  btnCrearEquipo.style.display = esDelegado ? "inline-block" : "none";
}