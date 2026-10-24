/**
 * Frontend GESTOR - consume el gateway (http://localhost:8080)
 * Sin Supabase ni claves en el navegador: solo JWT y cookies HttpOnly.
 */

const API = "http://localhost:8080";

let token = localStorage.getItem("gestor_token");
let usuario = JSON.parse(localStorage.getItem("gestor_usuario") || "null");

// ---------- cliente HTTP ----------

async function api(ruta, opciones = {}) {
  const headers = { ...(opciones.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opciones.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

  const res = await fetch(API + ruta, { ...opciones, headers, credentials: "include" });
  if (res.status === 204) return null;

  let datos = null;
  try {
    datos = await res.json();
  } catch {
    /* respuesta sin cuerpo */
  }

  if (!res.ok) {
    const mensaje = datos?.error?.message || datos?.message || `Error ${res.status}`;
    const err = new Error(mensaje);
    err.status = res.status;
    throw err;
  }
  return datos;
}

// ---------- sesión ----------

function guardarSesion(data) {
  token = data.accessToken;
  usuario = data.usuario;
  localStorage.setItem("gestor_token", token);
  localStorage.setItem("gestor_usuario", JSON.stringify(usuario));
  pintarSesion();
}

function cerrarSesionLocal() {
  token = null;
  usuario = null;
  localStorage.removeItem("gestor_token");
  localStorage.removeItem("gestor_usuario");
  pintarSesion();
}

async function restaurarSesion() {
  if (!token) return;
  try {
    const r = await api("/api/auth/me");
    usuario = r.usuario;
  } catch {
    try {
      const r = await api("/api/auth/refresh", { method: "POST" });
      guardarSesion(r);
      return;
    } catch {
      cerrarSesionLocal();
      return;
    }
  }
  pintarSesion();
}

function pintarSesion() {
  const btnLogin = document.getElementById("btnLogin");
  const btnLogout = document.getElementById("btnLogout");
  const greeting = document.getElementById("userGreeting");
  const btnCrearTorneo = document.getElementById("btnCrearTorneo");
  const btnCrearEquipo = document.getElementById("btnCrearEquipo");

  if (usuario) {
    btnLogin.style.display = "none";
    btnLogout.style.display = "inline-block";
    greeting.textContent = `Hola, ${usuario.nombre} (${usuario.rol})`;
    btnCrearTorneo.style.display = usuario.rol === "admin" ? "inline-block" : "none";
    btnCrearEquipo.style.display = "inline-block";
  } else {
    btnLogin.style.display = "inline-block";
    btnLogout.style.display = "none";
    greeting.textContent = "";
    btnCrearTorneo.style.display = "none";
    btnCrearEquipo.style.display = "none";
  }
}

function exigirSesion() {
  if (usuario) return true;
  nuevoError("Inicia sesión para continuar.");
  return false;
}

// ---------- navegación por hash ----------

function mostrarVista(nombre) {
  const validas = ["home", "torneos", "equipos", "inscripciones", "posiciones", "estadisticas"];
  const vista = validas.includes(nombre) ? nombre : "home";
  document.querySelectorAll(".vista").forEach((s) => s.classList.add("d-none"));
  document.getElementById(vista).classList.remove("d-none");
  document.querySelectorAll("#menu .list-group-item").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("href") === `#${vista}`);
  });

  if (vista === "home" || vista === "torneos") cargarTorneos();
  if (vista === "equipos") cargarEquipos();
  if (vista === "inscripciones") cargarInscripciones();
  if (vista === "posiciones") cargarSelectorPosiciones();
  if (vista === "estadisticas") cargarSelectorEstadisticas();
}

window.addEventListener("hashchange", () => mostrarVista(location.hash.slice(1)));

// ---------- mensajes ----------

function nuevoError(texto) {
  const cont = document.getElementById("authError");
  cont.textContent = texto;
  cont.classList.remove("d-none");
}

function limpiarError() {
  document.getElementById("authError").classList.add("d-none");
}

function tarjeta(html) {
  return `<div class="card mb-3"><div class="card-body">${html}</div></div>`;
}

function badge(estado) {
  const colores = {
    pendiente: "bg-warning text-dark",
    aceptada: "bg-success",
    rechazada: "bg-danger",
    borrador: "bg-secondary",
    inscripciones_abiertas: "bg-info text-dark",
    en_juego: "bg-primary",
    finalizado: "bg-dark",
    archivado: "bg-secondary",
  };
  return `<span class="badge ${colores[estado] || "bg-secondary"}">${estado}</span>`;
}

// ---------- torneos ----------

async function cargarTorneos() {
  const cont = document.getElementById("listaTorneos");
  const home = document.getElementById("homePublico");
  try {
    const r = await api("/api/public/torneos");
    const torneos = r.torneos || [];
    if (torneos.length === 0) {
      cont.innerHTML = tarjeta("<p class='mb-0'>Aún no hay torneos publicados.</p>");
      home.innerHTML = tarjeta("<p class='mb-0'>Aún no hay torneos publicados.</p>");
      return;
    }
    const filas = torneos
      .map(
        (t) => `
      <tr>
        <td>${t.nombre}</td>
        <td>${t.temporada}</td>
        <td>${t.formato}</td>
        <td>${badge(t.estado)}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-primary" data-detalle="${t.id}" data-nombre="${t.nombre}">Ver detalle</button>
        </td>
      </tr>`,
      )
      .join("");
    const tabla = `
      <div class="table-responsive">
        <table class="table table-hover align-middle">
          <thead><tr><th>Torneo</th><th>Temporada</th><th>Formato</th><th>Estado</th><th></th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>`;
    cont.innerHTML = tabla;
    home.innerHTML = tabla;
    document.querySelectorAll("[data-detalle]").forEach((b) => {
      b.addEventListener("click", () => verDetalleTorneo(b.dataset.detalle, b.dataset.nombre));
    });
  } catch (e) {
    cont.innerHTML = tarjeta(`<p class='text-danger mb-0'>${e.message}</p>`);
  }
}

async function verDetalleTorneo(id, nombre) {
  document.getElementById("detalleTitulo").textContent = nombre;
  document.getElementById("detalleCuerpo").innerHTML = "<p>Cargando…</p>";
  document.getElementById("detalleFooter").innerHTML = "";
  bootstrap.Modal.getOrCreateInstance(document.getElementById("modalDetalle")).show();

  try {
    const [torneo, pos, partidos] = await Promise.all([
      api(`/api/public/torneos/${id}`),
      api(`/api/public/torneos/${id}/posiciones`),
      api(`/api/public/torneos/${id}/partidos`),
    ]);

    let html = `<p>${torneo.torneo.descripcion || ""}</p>`;

    const tablas = pos.tablas || [];
    if (tablas.length === 0 || tablas[0].filas.length === 0) {
      html += "<p class='text-muted'>Sin posiciones todavía.</p>";
    } else {
      tablas.forEach((tb) => {
        html += tb.grupo ? `<h6>Grupo: ${tb.grupo}</h6>` : "";
        html += `<div class="table-responsive"><table class="table table-sm">
          <thead><tr><th>#</th><th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>GF</th><th>GC</th><th>DG</th><th>Pts</th></tr></thead><tbody>`;
        tb.filas.forEach((f, i) => {
          html += `<tr><td>${i + 1}</td><td>${f.equipo.nombre}</td><td>${f.pj}</td><td>${f.pg}</td>
            <td>${f.pe}</td><td>${f.pp}</td><td>${f.gf}</td><td>${f.gc}</td><td>${f.dg}</td><td><strong>${f.puntos}</strong></td></tr>`;
        });
        html += "</tbody></table></div>";
      });
    }

    const lista = partidos.partidos || [];
    html += "<h6>Partidos</h6>";
    if (lista.length === 0) {
      html += "<p class='text-muted'>Sin partidos programados.</p>";
    } else {
      html += '<ul class="list-group">';
      lista.slice(0, 20).forEach((p) => {
        const marcador =
          p.golesLocal !== null && p.golesVisitante !== null
            ? `<strong>${p.golesLocal} - ${p.golesVisitante}</strong>`
            : `<small>${p.fechaHora ? new Date(p.fechaHora).toLocaleString() : "por programar"}</small>`;
        html += `<li class="list-group-item d-flex justify-content-between align-items-center">
          <span>${p.local.nombre} vs ${p.visitante.nombre}</span>
          <span>${marcador} ${badge(p.estado)}</span></li>`;
      });
      html += "</ul>";
    }

    document.getElementById("detalleCuerpo").innerHTML = html;
    document.getElementById("detalleFooter").innerHTML = `
      <a class="btn btn-outline-secondary btn-sm" href="${API}/api/public/torneos/${id}/posiciones.xlsx">Descargar Excel</a>
      <button class="btn btn-primary" data-inscribir="${id}">Inscribir mi equipo</button>`;
    document.querySelector("[data-inscribir]").addEventListener("click", () => inscribir(id));
  } catch (e) {
    document.getElementById("detalleCuerpo").innerHTML = `<p class="text-danger">${e.message}</p>`;
  }
}

async function crearTorneo() {
  const nombre = prompt("Nombre del torneo:");
  if (!nombre) return;
  const temporada = prompt("Temporada (ej. 2026):", "2026");
  if (!temporada) return;
  const formato = prompt("Formato: liguilla o grupos:", "liguilla");
  if (!formato) return;
  try {
    await api("/api/matches/torneos", {
      method: "POST",
      body: JSON.stringify({ nombre, temporada, formato }),
    });
    alert("Torneo creado (estado borrador).");
    cargarTorneos();
  } catch (e) {
    alert(e.message);
  }
}

async function inscribir(torneoId) {
  if (!exigirSesion()) return;
  try {
    const r = await api("/api/teams/equipos");
    const equipos = r.equipos || [];
    if (equipos.length === 0) {
      alert("Primero crea un equipo en la sección Equipos.");
      location.hash = "#equipos";
      return;
    }
    const lista = equipos.map((e, i) => `${i + 1}. ${e.nombre}`).join("\n");
    const eleccion = prompt(`¿Con qué equipo te inscribes?\n${lista}\n\nNúmero o ID del equipo:`);
    if (!eleccion) return;
    const equipo = equipos[Number(eleccion) - 1] || equipos.find((e) => e.id === eleccion);
    if (!equipo) return alert("Equipo no encontrado.");
    const ins = await api(`/api/matches/torneos/${torneoId}/inscripciones`, {
      method: "POST",
      body: JSON.stringify({ equipoId: equipo.id }),
    });
    alert(`Inscripción enviada: ${ins.inscripcion.estado}`);
    location.hash = "#inscripciones";
  } catch (e) {
    alert(e.message);
  }
}

// ---------- equipos ----------

async function cargarEquipos() {
  const cont = document.getElementById("listaEquipos");
  if (!usuario) {
    cont.innerHTML = tarjeta("<p class='mb-0'>Inicia sesión para ver tus equipos.</p>");
    return;
  }
  try {
    const r = await api("/api/teams/equipos");
    const equipos = r.equipos || [];
    if (equipos.length === 0) {
      cont.innerHTML = tarjeta("<p class='mb-0'>No tienes equipos. ¡Crea uno!</p>");
      return;
    }
    cont.innerHTML = `<div class="row">${equipos
      .map(
        (e) => `
      <div class="col-md-4">
        <div class="card mb-3">
          <div class="card-body">
            <h5 class="card-title">${e.nombre}</h5>
            <p class="card-text text-muted">${e.municipio || ""}</p>
          </div>
        </div>
      </div>`,
      )
      .join("")}</div>`;
  } catch (e) {
    cont.innerHTML = tarjeta(`<p class='text-danger mb-0'>${e.message}</p>`);
  }
}

async function crearEquipo() {
  if (!exigirSesion()) return;
  const nombre = prompt("Nombre del equipo:");
  if (!nombre) return;
  const municipio = prompt("Municipio:");
  if (!municipio) return;
  try {
    await api("/api/teams/equipos", {
      method: "POST",
      body: JSON.stringify({ nombre, municipio }),
    });
    alert("Equipo creado.");
    cargarEquipos();
  } catch (e) {
    alert(e.message);
  }
}

// ---------- inscripciones ----------

async function cargarInscripciones() {
  const cont = document.getElementById("listaInscripciones");
  if (!usuario) {
    cont.innerHTML = tarjeta("<p class='mb-0'>Inicia sesión para ver tus inscripciones.</p>");
    return;
  }
  try {
    const r = await api("/api/matches/mis-inscripciones");
    const inscripciones = r.inscripciones || [];
    if (inscripciones.length === 0) {
      cont.innerHTML = tarjeta("<p class='mb-0'>No tienes inscripciones. Ve a Torneos e inscribe tu equipo.</p>");
      return;
    }
    cont.innerHTML = `<div class="list-group">${inscripciones
      .map(
        (i) => `
      <div class="list-group-item d-flex justify-content-between align-items-center">
        <span><strong>${i.torneo}</strong> — ${i.equipo}</span>
        ${badge(i.estado)}
      </div>`,
      )
      .join("")}</div>`;
  } catch (e) {
    cont.innerHTML = tarjeta(`<p class='text-danger mb-0'>${e.message}</p>`);
  }
}

// ---------- posiciones ----------

async function cargarSelectorPosiciones() {
  const sel = document.getElementById("selectPosiciones");
  try {
    const r = await api("/api/public/torneos");
    const torneos = r.torneos || [];
    sel.innerHTML = '<option value="">Selecciona un torneo</option>' +
      torneos.map((t) => `<option value="${t.id}">${t.nombre}</option>`).join("");
    document.getElementById("tablaPosiciones").innerHTML = "";
  } catch (e) {
    document.getElementById("tablaPosiciones").innerHTML = `<p class="text-danger">${e.message}</p>`;
  }
}

async function mostrarPosiciones() {
  const id = document.getElementById("selectPosiciones").value;
  const cont = document.getElementById("tablaPosiciones");
  if (!id) return (cont.innerHTML = "");
  try {
    const r = await api(`/api/public/torneos/${id}/posiciones`);
    const tablas = r.tablas || [];
    if (tablas.length === 0 || tablas[0].filas.length === 0) {
      cont.innerHTML = "<p class='text-muted'>Sin posiciones todavía.</p>";
      return;
    }
    cont.innerHTML = tablas
      .map(
        (tb) => `
      ${tb.grupo ? `<h5>Grupo: ${tb.grupo}</h5>` : ""}
      <div class="table-responsive">
        <table class="table table-striped">
          <thead><tr><th>#</th><th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>GF</th><th>GC</th><th>DG</th><th>Pts</th></tr></thead>
          <tbody>
            ${tb.filas
              .map(
                (f, i) => `<tr><td>${i + 1}</td><td>${f.equipo.nombre}</td><td>${f.pj}</td><td>${f.pg}</td>
                <td>${f.pe}</td><td>${f.pp}</td><td>${f.gf}</td><td>${f.gc}</td><td>${f.dg}</td><td><strong>${f.puntos}</strong></td></tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>`,
      )
      .join("");
  } catch (e) {
    cont.innerHTML = `<p class="text-danger">${e.message}</p>`;
  }
}

// ---------- estadísticas ----------

async function cargarSelectorEstadisticas() {
  const sel = document.getElementById("selectEstadisticas");
  const cont = document.getElementById("contenidoEstadisticas");
  if (!usuario) {
    sel.innerHTML = "";
    cont.innerHTML = tarjeta("<p class='mb-0'>Inicia sesión para ver estadísticas.</p>");
    return;
  }
  try {
    const r = await api("/api/matches/torneos");
    const torneos = r.torneos || [];
    sel.innerHTML = '<option value="">Selecciona un torneo</option>' +
      torneos.map((t) => `<option value="${t.id}">${t.nombre}</option>`).join("");
    cont.innerHTML = "";
  } catch (e) {
    cont.innerHTML = `<p class="text-danger">${e.message}</p>`;
  }
}

async function mostrarEstadisticas() {
  const id = document.getElementById("selectEstadisticas").value;
  const cont = document.getElementById("contenidoEstadisticas");
  if (!id) return (cont.innerHTML = "");
  try {
    const s = await api(`/api/matches/torneos/${id}/estadisticas`);
    const bloque = (titulo, filas, render) =>
      filas && filas.length
        ? `<h5>${titulo}</h5><ul class="list-group mb-3">${filas.slice(0, 10).map((f) => `<li class="list-group-item">${render(f)}</li>`).join("")}</ul>`
        : "";
    cont.innerHTML =
      bloque("Goleadores", s.goleadores, (g) => `<strong>${g.jugador}</strong> (${g.equipo}): ${g.total}`) +
      bloque("Asistentes", s.asistentes, (a) => `<strong>${a.jugador}</strong> (${a.equipo}): ${a.total}`) +
      bloque("Valla menos vencida", s.vallaMenosVencida, (v) => `${v.equipo}: ${v.golesContra} GC en ${v.pj} PJ (prom. ${v.promedio})`) ||
      "<p class='text-muted'>Sin estadísticas todavía.</p>";
  } catch (e) {
    cont.innerHTML = `<p class="text-danger">${e.message}</p>`;
  }
}

// ---------- modal de autenticación ----------

function abrirAuth(tab = "login") {
  limpiarError();
  cambiarTab(tab);
  bootstrap.Modal.getOrCreateInstance(document.getElementById("modalAuth")).show();
}

function cambiarTab(tab) {
  document.querySelectorAll("#authTabs button").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  document.getElementById("formLogin").classList.toggle("d-none", tab !== "login");
  document.getElementById("formRegistro").classList.toggle("d-none", tab !== "registro");
}

async function enviarLogin(e) {
  e.preventDefault();
  limpiarError();
  try {
    const r = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        correo: document.getElementById("loginCorreo").value,
        contrasena: document.getElementById("loginPassword").value,
      }),
    });
    guardarSesion(r);
    bootstrap.Modal.getInstance(document.getElementById("modalAuth")).hide();
    location.hash = "#torneos";
    mostrarVista("torneos");
  } catch (err) {
    nuevoError(err.message);
  }
}

async function enviarRegistro(e) {
  e.preventDefault();
  limpiarError();
  try {
    await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        nombre: document.getElementById("regNombre").value,
        correo: document.getElementById("regCorreo").value,
        contrasena: document.getElementById("regPassword").value,
        aceptaPolitica: document.getElementById("regPolitica").checked,
      }),
    });
    const r = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        correo: document.getElementById("regCorreo").value,
        contrasena: document.getElementById("regPassword").value,
      }),
    });
    guardarSesion(r);
    bootstrap.Modal.getInstance(document.getElementById("modalAuth")).hide();
    location.hash = "#equipos";
    mostrarVista("equipos");
  } catch (err) {
    nuevoError(err.message);
  }
}

// ---------- init ----------

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnLogin").addEventListener("click", () => abrirAuth("login"));
  document.getElementById("btnLogout").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    // La sesión local se cerrará igualmente.
  }

  cerrarSesionLocal();
  window.location.replace("/login/");
});

  document.querySelectorAll("#authTabs button").forEach((b) =>
    b.addEventListener("click", () => cambiarTab(b.dataset.tab)),
  );
  document.getElementById("formLogin").addEventListener("submit", enviarLogin);
  document.getElementById("formRegistro").addEventListener("submit", enviarRegistro);

  document.getElementById("btnCrearTorneo").addEventListener("click", crearTorneo);
  document.getElementById("btnCrearEquipo").addEventListener("click", crearEquipo);
  document.getElementById("selectPosiciones").addEventListener("change", mostrarPosiciones);
  document.getElementById("selectEstadisticas").addEventListener("change", mostrarEstadisticas);

  pintarSesion();
  restaurarSesion().then(() => {
  if (!token || !usuario) {
    window.location.replace("/login/");
    return;
  }

  pintarSesion();
  mostrarVista(location.hash.slice(1) || "home");
});
});
