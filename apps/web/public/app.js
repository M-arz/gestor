/**
 * Frontend GESTOR - consume el gateway (http://localhost:8080)
 * Sin Supabase ni claves en el navegador: solo JWT y cookies HttpOnly.
 */

const API = "http://localhost:8080";

let token = localStorage.getItem("gestor_token");
let usuario = JSON.parse(localStorage.getItem("gestor_usuario") || "null");
let torneoDetalleFiltro = "todas";
let filtroInscripcionesDelegado = "todas";
let filtroInscripcionesAdmin = "pendientes";

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
  const esAdmin = usuario && usuario.rol === "admin";
  const esDelegado = usuario && usuario.rol === "delegado";

  if (usuario) {
    btnLogin.style.display = "none";
    btnLogout.style.display = "inline-block";
    greeting.textContent = `Hola, ${usuario.nombre} (${usuario.rol})`;
    btnCrearTorneo.style.display = esAdmin ? "inline-block" : "none";
    btnCrearEquipo.style.display = esDelegado ? "inline-block" : "none";
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
  const validas = ["home", "torneos", "equipos", "inscripciones", "posiciones", "estadisticas", "perfil"];
  const vista = validas.includes(nombre) ? nombre : "home";
  document.querySelectorAll(".vista").forEach((s) => s.classList.add("d-none"));
  document.getElementById(vista).classList.remove("d-none");
  document.querySelectorAll("#menu .list-group-item").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("href") === `#${vista}`);
  });

  if (vista === "home") cargarHome();
  if (vista === "torneos") cargarTorneos();
  if (vista === "equipos") cargarEquipos();
  if (vista === "inscripciones") cargarInscripciones();
  if (vista === "posiciones") cargarSelectorPosiciones();
  if (vista === "estadisticas") cargarSelectorEstadisticas();
  if (vista === "perfil") cargarPerfil();
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
    habilitado: "bg-success",
    en_conflicto: "bg-warning text-dark",
    sin_autorizacion: "bg-secondary",
    retirado: "bg-danger",
  };
  return `<span class="badge ${colores[estado] || "bg-secondary"}">${estado}</span>`;
}

// ---------- torneos ----------

async function cargarTorneos() {
  const cont = document.getElementById("listaTorneos");
  const home = document.getElementById("homePublico");

  if (usuario && usuario.rol === "admin") {
    try {
      const r = await api("/api/matches/torneos");
      const torneos = r.torneos || [];
      if (torneos.length === 0) {
        cont.innerHTML = tarjeta("<p class='mb-0'>Todavía no administras ningún torneo.</p>");
        home.innerHTML = tarjeta("<p class='mb-0'>Todavía no administras ningún torneo.</p>");
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
            <button class="btn btn-sm btn-outline-primary" data-admin-torneo="${t.id}">Gestionar</button>
          </td>
        </tr>`,
        )
        .join("");
      const tabla = `
        <div class="gestor-dashboard">
          <div class="gestor-summary-grid">
            <div class="gestor-summary-card success">
              <span>Abiertos</span>
              <strong>${torneos.filter((t) => t.estado === "inscripciones_abiertas").length}</strong>
            </div>
            <div class="gestor-summary-card primary">
              <span>En juego</span>
              <strong>${torneos.filter((t) => t.estado === "en_juego").length}</strong>
            </div>
            <div class="gestor-summary-card dark">
              <span>Total</span>
              <strong>${torneos.length}</strong>
            </div>
          </div>
          <div class="gestor-panel">
            <div class="table-responsive">
              <table class="table table-hover align-middle gestor-table">
                <thead><tr><th>Torneo</th><th>Temporada</th><th>Formato</th><th>Estado</th><th></th></tr></thead>
                <tbody>${filas}</tbody>
              </table>
            </div>
          </div>
        </div>`;
      cont.innerHTML = tabla;
      home.innerHTML = tabla;
      document.querySelectorAll("[data-admin-torneo]").forEach((b) => {
        b.addEventListener("click", () => abrirDetalleTorneoAdmin(b.dataset.adminTorneo));
      });
      return;
    } catch (e) {
      cont.innerHTML = tarjeta(`<p class='text-danger mb-0'>${e.message}</p>`);
      return;
    }
  }

  if (usuario && usuario.rol === "delegado") {
    try {
      const r = await api("/api/matches/torneos");
      const torneos = (r.torneos || []).filter((t) => t.estado === "inscripciones_abiertas");
      if (torneos.length === 0) {
        const mensaje = "No hay torneos abiertos para solicitar inscripción en este momento.";
        cont.innerHTML = tarjeta(`<p class='mb-0'>${mensaje}</p>`);
        home.innerHTML = tarjeta(`<p class='mb-0'>${mensaje}</p>`);
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
        <div class="gestor-dashboard">
          <div class="gestor-summary-grid">
            <div class="gestor-summary-card success">
              <span>Disponibles</span>
              <strong>${torneos.length}</strong>
            </div>
            <div class="gestor-summary-card primary">
              <span>Estado</span>
              <strong>Abiertas</strong>
            </div>
            <div class="gestor-summary-card dark">
              <span>Acción</span>
              <strong>Solicitar</strong>
            </div>
          </div>
          <div class="gestor-panel">
            <div class="table-responsive">
              <table class="table table-hover align-middle gestor-table">
                <thead><tr><th>Torneo</th><th>Temporada</th><th>Formato</th><th>Estado</th><th></th></tr></thead>
                <tbody>${filas}</tbody>
              </table>
            </div>
          </div>
        </div>`;
      cont.innerHTML = tabla;
      home.innerHTML = tabla;
      document.querySelectorAll("[data-detalle]").forEach((b) => {
        b.addEventListener("click", () => verDetalleTorneo(b.dataset.detalle, b.dataset.nombre));
      });
      return;
    } catch (e) {
      cont.innerHTML = tarjeta(`<p class='text-danger mb-0'>${e.message}</p>`);
      return;
    }
  }

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
      <div class="gestor-dashboard">
        <div class="gestor-summary-grid">
          <div class="gestor-summary-card success">
            <span>Publicados</span>
            <strong>${torneos.length}</strong>
          </div>
          <div class="gestor-summary-card primary">
            <span>Activos</span>
            <strong>${torneos.filter((t) => t.estado === "inscripciones_abiertas").length}</strong>
          </div>
          <div class="gestor-summary-card dark">
            <span>Estado</span>
            <strong>${torneos.some((t) => t.estado === "en_juego") ? "En juego" : "Catalogado"}</strong>
          </div>
        </div>
        <div class="gestor-panel">
          <div class="table-responsive">
            <table class="table table-hover align-middle gestor-table">
              <thead><tr><th>Torneo</th><th>Temporada</th><th>Formato</th><th>Estado</th><th></th></tr></thead>
              <tbody>${filas}</tbody>
            </table>
          </div>
        </div>
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
    const [torneo, pos, partidos, misInscripciones] = await Promise.all([
      api(`/api/public/torneos/${id}`),
      api(`/api/public/torneos/${id}/posiciones`),
      api(`/api/public/torneos/${id}/partidos`),
      usuario && usuario.rol === "delegado" ? api("/api/matches/mis-inscripciones") : Promise.resolve({ inscripciones: [] }),
    ]);

    let html = `<p>${torneo.torneo.descripcion || ""}</p>`;
    const inscripcionActual = (misInscripciones?.inscripciones || []).find((i) => i.torneoId === id);
    if (usuario && usuario.rol === "delegado" && inscripcionActual) {
      html += `
        <div class="alert alert-info mb-3">
          Ya tienes una inscripción para este torneo con el equipo <strong>${inscripcionActual.equipo}</strong>.
          Estado: ${badge(inscripcionActual.estado)}
        </div>`;
    }

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
    const puedeSolicitar =
      usuario && usuario.rol === "delegado" && (!inscripcionActual || inscripcionActual.estado === "rechazada");
    const footerHtml = [];
    if (usuario && usuario.rol === "admin") {
      footerHtml.push(`<a class="btn btn-outline-secondary btn-sm" href="${API}/api/public/torneos/${id}/posiciones.xlsx">Descargar Excel</a>`);
    }
    if (puedeSolicitar && torneo.torneo.estado === "inscripciones_abiertas") {
      footerHtml.push(`<button class="btn btn-primary" data-inscribir="${id}">Solicitar inscripción</button>`);
    } else if (usuario && usuario.rol === "delegado" && inscripcionActual) {
      footerHtml.push(`<button class="btn btn-outline-secondary" disabled>Solicitud enviada</button>`);
    }
    document.getElementById("detalleFooter").innerHTML = footerHtml.join(" ");
    const btnInscribir = document.querySelector("[data-inscribir]");
    if (btnInscribir) btnInscribir.addEventListener("click", () => inscribir(id));
  } catch (e) {
    document.getElementById("detalleCuerpo").innerHTML = `<p class="text-danger">${e.message}</p>`;
  }
}

function abrirCrearTorneo() {
  if (!exigirSesion()) return;
  if (usuario.rol !== "admin") {
    alert("Solo los administradores pueden crear torneos.");
    return;
  }
  document.getElementById("formCrearTorneo").reset();
  bootstrap.Modal.getOrCreateInstance(document.getElementById("modalCrearTorneo")).show();
}

async function enviarCrearTorneo(event) {
  event.preventDefault();
  const payload = {
    nombre: document.getElementById("torneoNombre").value.trim(),
    temporada: document.getElementById("torneoTemporada").value.trim(),
    formato: document.getElementById("torneoFormato").value,
  };
  const descripcion = document.getElementById("torneoDescripcion").value.trim();
  if (descripcion) payload.descripcion = descripcion;

  try {
    await api("/api/matches/torneos", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    document.getElementById("formCrearTorneo").reset();
    bootstrap.Modal.getInstance(document.getElementById("modalCrearTorneo")).hide();
    alert("Torneo creado (estado borrador).");
    cargarTorneos();
  } catch (e) {
    alert(e.message);
  }
}

async function decidirInscripcion(inscripcionId, accion) {
  try {
    if (accion === "aceptar") {
      await api(`/api/matches/inscripciones/${inscripcionId}/aceptar`, { method: "POST" });
      alert("Inscripción aceptada.");
    } else {
      const motivo = prompt("Motivo del rechazo:", "No cumple los requisitos");
      if (!motivo) return;
      await api(`/api/matches/inscripciones/${inscripcionId}/rechazar`, {
        method: "POST",
        body: JSON.stringify({ motivo: motivo.trim() }),
      });
      alert("Inscripción rechazada.");
    }
    const modal = bootstrap.Modal.getInstance(document.getElementById("modalDetalle"));
    if (modal) modal.hide();
    setTimeout(() => abrirDetalleTorneoAdmin(document.getElementById("detalleTitulo").dataset.torneoId), 100);
  } catch (e) {
    alert(e.message);
  }
}

let jugadorConflictoActual = null;

async function verJugadorEnConflicto(jugadorId, equipoId, inscripcionId) {
  try {
    const r = await api(`/api/teams/equipos/${equipoId}/jugadores`);
    const jugador = (r.jugadores || []).find((j) => j.id === jugadorId);
    if (!jugador) {
      throw new Error("No se encontró el jugador en el equipo.");
    }
    const plantilla = await api(`/api/matches/inscripciones/${inscripcionId}/plantilla`).catch(() => ({ plantilla: [] }));
    const item = (plantilla.plantilla || []).find((p) => p.jugadorId === jugadorId);
    jugadorConflictoActual = { jugadorId, equipoId, inscripcionId };
    document.getElementById("detalleJugadorConflicto").innerHTML = `
      <div class="card border-warning">
        <div class="card-body">
          <h6 class="mb-3">${jugador.nombres} ${jugador.apellidos}</h6>
          <p class="mb-1"><strong>Equipo:</strong> ${jugador.equipoNombre || "Equipo"}</p>
          <p class="mb-1"><strong>Dorsal:</strong> ${jugador.dorsal ?? "-"}</p>
          <p class="mb-1"><strong>Posición:</strong> ${jugador.posicion ?? "-"}</p>
          <p class="mb-1"><strong>Documento:</strong> ${jugador.documentoEnmascarado || "No disponible"}</p>
          <p class="mb-1"><strong>Estado torneo:</strong> ${badge(item?.estado || "en_conflicto")}</p>
          <p class="mb-0"><strong>Estado ficha:</strong> ${jugador.habilitado ? "Habilitado" : "Sin autorización"}</p>
        </div>
      </div>
    `;
    bootstrap.Modal.getOrCreateInstance(document.getElementById("modalJugadorConflicto")).show();
  } catch (e) {
    alert(e.message);
  }
}

async function corregirJugadorEnConflicto() {
  if (!jugadorConflictoActual) return;
  const { jugadorId, equipoId } = jugadorConflictoActual;
  try {
    const r = await api(`/api/teams/equipos/${equipoId}/jugadores`);
    const jugador = (r.jugadores || []).find((j) => j.id === jugadorId);
    if (!jugador) throw new Error("No se encontró el jugador.");

    const tipoActual = jugador.tipoDocumento || "CC";
    const documentoActual = window.prompt(
      `Introduce el documento correcto para ${jugador.nombres} ${jugador.apellidos}\n\nTipo actual: ${tipoActual}\nDocumento actual enmascarado: ${jugador.documentoEnmascarado || "-"}`,
      jugador.documento || "",
    );
    if (documentoActual === null) return;
    const tipo = window.prompt("Tipo de documento (CC, TI, RC, CE, PPT, PEP, PA):", tipoActual);
    if (tipo === null) return;
    const payload = {
      tipoDocumento: String(tipo).trim().toUpperCase(),
      documento: documentoActual.trim(),
      autorizacionAcudiente: true,
    };
    await api(`/api/teams/jugadores/${jugadorId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    bootstrap.Modal.getInstance(document.getElementById("modalJugadorConflicto")).hide();
    alert("Jugador corregido. La plantilla del torneo se recalculará al refrescar.");
    const torneoId = document.getElementById("detalleTitulo").dataset.torneoId;
    if (torneoId) await abrirDetalleTorneoAdmin(torneoId);
  } catch (e) {
    alert(e.message);
  }
}

async function retirarJugadorEnConflicto() {
  if (!jugadorConflictoActual) return;
  try {
    const ok = window.confirm("¿Quieres retirar este jugador del equipo para resolver el conflicto?");
    if (!ok) return;
    await api(`/api/teams/jugadores/${jugadorConflictoActual.jugadorId}/anonimizar`, { method: "POST" });
    bootstrap.Modal.getInstance(document.getElementById("modalJugadorConflicto")).hide();
    alert("Jugador retirado.");
    const torneoId = document.getElementById("detalleTitulo").dataset.torneoId;
    if (torneoId) await abrirDetalleTorneoAdmin(torneoId);
  } catch (e) {
    alert(e.message);
  }
}

async function abrirDetalleTorneoAdmin(id) {
  document.getElementById("detalleTitulo").textContent = "Gestionar torneo";
  document.getElementById("detalleTitulo").dataset.torneoId = id;
  document.getElementById("detalleCuerpo").innerHTML = "<p>Cargando…</p>";
  document.getElementById("detalleFooter").innerHTML = "";
  bootstrap.Modal.getOrCreateInstance(document.getElementById("modalDetalle")).show();

  try {
    const [torneoRes, inscRes, adminsRes, gruposRes] = await Promise.all([
      api(`/api/matches/torneos/${id}`),
      api(`/api/matches/torneos/${id}/inscripciones`),
      api(`/api/matches/torneos/${id}/administradores`),
      api(`/api/matches/torneos/${id}/grupos`).catch(() => ({ grupos: [] })),
    ]);
    const torneo = torneoRes.torneo;
    const inscripciones = inscRes.inscripciones || [];
    const administradores = adminsRes.administradores || [];
    const grupos = gruposRes.grupos || [];
    const estados = ["borrador", "inscripciones_abiertas", "en_juego", "finalizado", "archivado"];
    const equiposAceptados = inscripciones.filter((i) => i.estado === "aceptada");
    const plantillasMap = Object.fromEntries(
      (
        await Promise.all(
          equiposAceptados.map(async (i) => {
            try {
              const r = await api(`/api/matches/inscripciones/${i.id}/plantilla`);
              return [i.id, r.plantilla || []];
            } catch {
              return [i.id, []];
            }
          }),
        )
      ).filter(([_, lista]) => Array.isArray(lista)),
    );
    const conflictos = Object.entries(plantillasMap)
      .flatMap(([inscripcionId, lista]) =>
        (lista || [])
          .filter((j) => j.estado === "en_conflicto" || j.estado === "sin_autorizacion")
          .map((j) => ({ ...j, inscripcionId })),
      );
    const administradoresHtml = administradores.length
      ? `<ul class="list-group small">${administradores
          .map(
            (a) =>
              `<li class="list-group-item d-flex justify-content-between align-items-center"><span>${a.nombre || a.correo || a.id}</span><span class="text-muted">${a.rol || "admin"}</span></li>`,
          )
          .join("")}</ul>`
      : "<p class='text-muted mb-0'>Sin administradores adicionales.</p>";
    const gruposHtml = grupos.length
      ? `<ul class="list-group small">${grupos
          .map(
            (g) =>
              `<li class="list-group-item d-flex justify-content-between align-items-center"><span>${g.nombre}</span><span class="badge bg-light text-dark">${(g.equipos || []).length}</span></li>`,
          )
          .join("")}</ul>`
      : "<p class='text-muted mb-0'>Aún no se han generado grupos.</p>";
    const equiposHtml = equiposAceptados.length
      ? `<ul class="list-group small">${equiposAceptados
          .map(
            (i) =>
              `<li class="list-group-item d-flex justify-content-between align-items-center"><span>${i.equipo}</span><span>${badge(i.grupo || "sin grupo")}</span></li>`,
          )
          .join("")}</ul>`
      : "<p class='text-muted mb-0'>Sin equipos aceptados todavía.</p>";
    const conflictosHtml = conflictos.length
      ? `<div class="list-group small">${conflictos
          .map(
            (j) => `
              <div class="list-group-item">
                <div class="d-flex justify-content-between align-items-center gap-2">
                  <div>
                    <strong>${j.nombre}</strong><br>
                    <small>${j.posicion || "-"} • ${j.dorsal ?? "-"}</small>
                  </div>
                  <div class="d-flex gap-2 align-items-center">
                    ${badge(j.estado)}
                    <button class="btn btn-sm btn-outline-secondary" data-ver-conflicto="${j.jugadorId}|${inscripciones.find((i) => i.id === j.inscripcionId)?.equipoId || ""}|${j.inscripcionId}">Ver</button>
                    <button class="btn btn-sm btn-outline-primary" data-corregir-conflicto="${j.jugadorId}|${inscripciones.find((i) => i.id === j.inscripcionId)?.equipoId || ""}">Corregir</button>
                    <button class="btn btn-sm btn-outline-danger" data-retirar-conflicto="${j.jugadorId}">Retirar</button>
                  </div>
                </div>
              </div>`,
          )
          .join("")}</div>`
      : "<p class='text-muted mb-0'>Sin conflictos de documento o autorización.</p>";
    const listaInscripciones = [...inscripciones].sort((a, b) => {
      const aConflict = conflictos.some((c) => c.inscripcionId === a.id);
      const bConflict = conflictos.some((c) => c.inscripcionId === b.id);
      return Number(bConflict) - Number(aConflict);
    });

    document.getElementById("detalleCuerpo").innerHTML = `
      <div class="mb-3">
        <h4>${torneo.nombre}</h4>
        <p class="mb-1"><strong>Temporada:</strong> ${torneo.temporada}</p>
        <p class="mb-1"><strong>Formato:</strong> ${torneo.formato}</p>
        <p class="mb-1"><strong>Estado:</strong> ${badge(torneo.estado)}</p>
        <p class="mb-3"><strong>Descripción:</strong> ${torneo.descripcion || "Sin descripción"}</p>
      </div>

      <div class="row g-3">
        <div class="col-md-6">
          <label class="form-label">Cambiar estado</label>
          <div class="input-group">
            <select id="selectEstadoTorneo" class="form-select">
              ${estados.map((e) => `<option value="${e}" ${e === torneo.estado ? "selected" : ""}>${e}</option>`).join("")}
            </select>
            <button class="btn btn-primary" data-cambiar-estado="${id}">Aplicar</button>
          </div>
        </div>
        <div class="col-md-6">
          <label class="form-label">Añadir administrador por correo</label>
          <form id="formTorneoAdmin" class="input-group">
            <input id="inputAdminCorreo" type="email" class="form-control" placeholder="correo@dominio.com" required>
            <button class="btn btn-success" type="submit">Añadir</button>
          </form>
        </div>
      </div>

      <div class="mt-4 d-flex flex-wrap gap-2">
        <button class="btn btn-outline-primary" data-generar-grupos="${id}">Generar grupos</button>
        <button class="btn btn-outline-primary" data-generar-fixture="${id}">Generar fixture</button>
      </div>

      <div class="row g-3 mt-2">
        <div class="col-md-6">
          <h6>Administradores</h6>
          ${administradoresHtml}
        </div>
        <div class="col-md-6">
          <h6>Grupos</h6>
          ${gruposHtml}
        </div>
      </div>

      <div class="mt-4">
        <h6>Equipos</h6>
        ${equiposHtml}
      </div>

      <div class="mt-4">
        <h6>Conflictos de documento / autorización</h6>
        ${conflictosHtml}
      </div>

      <div class="mt-4">
        <h6>Inscripciones</h6>
        <div class="mb-2">
          <select id="filtroInscripcionesTorneo" class="form-select form-select-sm">
            <option value="todas" ${torneoDetalleFiltro === "todas" ? "selected" : ""}>Todas</option>
            <option value="conflictos" ${torneoDetalleFiltro === "conflictos" ? "selected" : ""}>Con conflicto</option>
            <option value="pendientes" ${torneoDetalleFiltro === "pendientes" ? "selected" : ""}>Pendientes</option>
            <option value="aceptadas" ${torneoDetalleFiltro === "aceptadas" ? "selected" : ""}>Aceptadas</option>
          </select>
        </div>
        ${listaInscripciones.length ? `
          <div class="table-responsive">
            <table class="table table-sm table-hover align-middle">
              <thead>
                <tr>
                  <th>Equipo</th>
                  <th>Estado</th>
                  <th>Grupo</th>
                  <th>Motivo</th>
                  <th class="text-end">Acciones</th>
                </tr>
              </thead>
              <tbody>
                ${listaInscripciones
                  .filter((i) => {
                    const conflicto = conflictos.some((c) => c.inscripcionId === i.id);
                    if (torneoDetalleFiltro === "conflictos") return conflicto;
                    if (torneoDetalleFiltro === "pendientes") return i.estado === "pendiente";
                    if (torneoDetalleFiltro === "aceptadas") return i.estado === "aceptada";
                    return true;
                  })
                  .map(
                    (i) => `
                      <tr>
                        <td>${i.equipo}</td>
                        <td>${badge(i.estado)}</td>
                        <td>${i.grupo || "-"}</td>
                        <td>${i.motivoDecision || "-"}</td>
                        <td class="text-end">
                          ${i.estado === "pendiente" ? `
                            <div class="btn-group btn-group-sm">
                              <button class="btn btn-success" data-aceptar-inscripcion="${i.id}">Aceptar</button>
                              <button class="btn btn-outline-danger" data-rechazar-inscripcion="${i.id}">Rechazar</button>
                            </div>` : "-"}
                        </td>
                      </tr>`,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        ` : "<p class='text-muted mb-0'>Sin inscripciones recibidas.</p>"}
      </div>
    `;

    document.getElementById("filtroInscripcionesTorneo").addEventListener("change", (event) => {
      torneoDetalleFiltro = event.target.value;
      abrirDetalleTorneoAdmin(id);
    });

    document.getElementById("formTorneoAdmin").addEventListener("submit", async (event) => {
      event.preventDefault();
      const correo = document.getElementById("inputAdminCorreo").value.trim();
      if (!correo) return;
      try {
        await api(`/api/matches/torneos/${id}/administradores`, {
          method: "POST",
          body: JSON.stringify({ correo }),
        });
        alert("Administrador agregado.");
        abrirDetalleTorneoAdmin(id);
      } catch (e) {
        alert(e.message);
      }
    });

    document.querySelector("[data-cambiar-estado]").addEventListener("click", async () => {
      const estado = document.getElementById("selectEstadoTorneo").value;
      try {
        await api(`/api/matches/torneos/${id}/estado`, {
          method: "POST",
          body: JSON.stringify({ estado }),
        });
        alert(`Estado actualizado a ${estado}.`);
        abrirDetalleTorneoAdmin(id);
      } catch (e) {
        alert(e.message);
      }
    });

    document.querySelector("[data-generar-grupos]").addEventListener("click", async () => {
      const cantidad = Number(prompt("Número de grupos (2-16):", "2"));
      if (!cantidad || cantidad < 2 || cantidad > 16) {
        alert("Introduce un número válido.");
        return;
      }
      try {
        await api(`/api/matches/torneos/${id}/grupos/generar`, {
          method: "POST",
          body: JSON.stringify({ cantidad }),
        });
        alert("Grupos generados.");
        abrirDetalleTorneoAdmin(id);
      } catch (e) {
        alert(e.message);
      }
    });

    document.querySelector("[data-generar-fixture]").addEventListener("click", async () => {
      try {
        await api(`/api/matches/torneos/${id}/fixture/generar`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        alert("Fixture generado.");
        abrirDetalleTorneoAdmin(id);
      } catch (e) {
        alert(e.message);
      }
    });

    document.querySelectorAll("[data-aceptar-inscripcion]").forEach((btn) => {
      btn.addEventListener("click", () => decidirInscripcion(btn.dataset.aceptarInscripcion, "aceptar"));
    });
    document.querySelectorAll("[data-rechazar-inscripcion]").forEach((btn) => {
      btn.addEventListener("click", () => decidirInscripcion(btn.dataset.rechazarInscripcion, "rechazar"));
    });
    document.querySelectorAll("[data-ver-conflicto]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [jugadorId, equipoId, torneoIdParam] = btn.dataset.verConflicto.split("|");
        verJugadorEnConflicto(jugadorId, equipoId, torneoIdParam);
      });
    });
    document.querySelectorAll("[data-corregir-conflicto]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [jugadorId, equipoId] = btn.dataset.corregirConflicto.split("|");
        jugadorConflictoActual = { jugadorId, equipoId, inscripcionId: null };
        corregirJugadorEnConflicto();
      });
    });
    document.querySelectorAll("[data-retirar-conflicto]").forEach((btn) => {
      btn.addEventListener("click", () => {
        jugadorConflictoActual = { jugadorId: btn.dataset.retirarConflicto, equipoId: null, inscripcionId: null };
        retirarJugadorEnConflicto();
      });
    });

    document.getElementById("btnCorregirJugadorConflicto").onclick = corregirJugadorEnConflicto;
    document.getElementById("btnRetirarJugadorConflicto").onclick = retirarJugadorEnConflicto;

    document.getElementById("detalleFooter").innerHTML = '<button class="btn btn-outline-secondary" data-bs-dismiss="modal">Cerrar</button>';
  } catch (e) {
    document.getElementById("detalleCuerpo").innerHTML = `<p class="text-danger">${e.message}</p>`;
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
    const eleccion = prompt(`¿Con qué equipo quieres solicitar entrada al torneo?\n${lista}\n\nNúmero o ID del equipo:`);
    if (!eleccion) return;
    const equipo = equipos[Number(eleccion) - 1] || equipos.find((e) => e.id === eleccion);
    if (!equipo) return alert("Equipo no encontrado.");
    const ins = await api(`/api/matches/torneos/${torneoId}/inscripciones`, {
      method: "POST",
      body: JSON.stringify({ equipoId: equipo.id }),
    });
    alert(`Solicitud enviada para ${equipo.nombre}. Estado: ${ins.inscripcion.estado}`);
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
      cont.innerHTML = tarjeta(
        `<p class='mb-0'>${
          usuario.rol === "delegado"
            ? "No tienes equipos. ¡Crea uno!"
            : "No hay equipos asociados a los torneos que administras."
        }</p>`,
      );
      return;
    }

    cont.innerHTML = `<div class="row">${equipos
      .map(
        (e) => `
      <div class="col-md-4">
        <div class="card mb-3 h-100">
          <div class="card-body d-flex flex-column">
            <h5 class="card-title">${e.nombre}</h5>
            <p class="card-text text-muted">${e.municipio || ""}</p>
            <div class="mt-auto d-flex flex-wrap gap-2">
              <button class="btn btn-sm btn-outline-primary" data-ver-jugadores="${e.id}">Ver jugadores</button>
              ${usuario.rol === "delegado" ? `<button class="btn btn-sm btn-outline-success" data-crear-jugador="${e.id}">Añadir jugador</button>` : ""}
            </div>
          </div>
        </div>
      </div>`,
      )
      .join("")}</div>`;

    document.querySelectorAll("[data-ver-jugadores]").forEach((btn) => {
      btn.addEventListener("click", () => abrirJugadoresEquipo(btn.dataset.verJugadores));
    });
    if (usuario.rol === "delegado") {
      document.querySelectorAll("[data-crear-jugador]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const nombre = btn.closest(".card")?.querySelector(".card-title")?.textContent?.trim() || "equipo";
          abrirCrearJugador(btn.dataset.crearJugador, nombre);
        });
      });
    }
  } catch (e) {
    cont.innerHTML = tarjeta(`<p class='text-danger mb-0'>${e.message}</p>`);
  }
}

async function abrirJugadoresEquipo(equipoId) {
  try {
    document.getElementById("crearJugadorEquipoId").value = equipoId;
    const r = await api(`/api/teams/equipos/${equipoId}/jugadores`);
    const jugadores = r.jugadores || [];
    document.getElementById("jugadoresEquipoTitulo").textContent = "Jugadores del equipo";
    document.getElementById("contenidoJugadoresEquipo").innerHTML = jugadores.length
      ? `<div class="list-group">${jugadores
          .map(
            (j) => `
            <div class="list-group-item d-flex justify-content-between align-items-center gap-3">
              <div>
                <strong>${j.nombres} ${j.apellidos}</strong><br>
                <small>${j.posicion} • Dorsal ${j.dorsal} • ${j.documentoEnmascarado || "Sin documento"}</small>
              </div>
              <button class="btn btn-sm btn-outline-primary" data-editar-jugador='${JSON.stringify(j)}'>Editar</button>
            </div>`,
          )
          .join("")}</div>`
      : "<p class='text-muted mb-0'>Este equipo aún no tiene jugadores.</p>";

    document.querySelectorAll("[data-editar-jugador]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const jugador = JSON.parse(btn.dataset.editarJugador);
        abrirEditarJugador(jugador);
      });
    });
    bootstrap.Modal.getOrCreateInstance(document.getElementById("modalJugadoresEquipo")).show();
  } catch (e) {
    alert(e.message);
  }
}

function abrirCrearJugador(equipoId, nombre = "equipo") {
  if (!exigirSesion()) return;
  if (usuario.rol !== "delegado") {
    alert("Solo los delegados pueden crear jugadores.");
    return;
  }

  document.getElementById("crearJugadorEquipoId").value = equipoId;
  document.getElementById("crearJugadorTitulo").textContent = `Crear jugador · ${nombre}`;
  document.getElementById("formCrearJugador").reset();
  bootstrap.Modal.getOrCreateInstance(document.getElementById("modalCrearJugador")).show();
}

function abrirEditarJugador(jugador) {
  document.getElementById("editarJugadorId").value = jugador.id;
  document.getElementById("editarJugadorNombres").value = jugador.nombres || "";
  document.getElementById("editarJugadorApellidos").value = jugador.apellidos || "";
  document.getElementById("editarJugadorDorsal").value = jugador.dorsal ?? 0;
  document.getElementById("editarJugadorPosicion").value = jugador.posicion || "delantero";
  document.getElementById("editarJugadorHabilitado").value = String(Boolean(jugador.habilitado));
  bootstrap.Modal.getInstance(document.getElementById("modalJugadoresEquipo")).hide();
  bootstrap.Modal.getOrCreateInstance(document.getElementById("modalEditarJugador")).show();
}

async function enviarEditarJugador(event) {
  event.preventDefault();
  const id = document.getElementById("editarJugadorId").value;
  const payload = {
    nombres: document.getElementById("editarJugadorNombres").value.trim(),
    apellidos: document.getElementById("editarJugadorApellidos").value.trim(),
    dorsal: Number(document.getElementById("editarJugadorDorsal").value),
    posicion: document.getElementById("editarJugadorPosicion").value,
    habilitado: document.getElementById("editarJugadorHabilitado").value === "true",
  };

  try {
    await api(`/api/teams/jugadores/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    bootstrap.Modal.getInstance(document.getElementById("modalEditarJugador")).hide();
    alert("Jugador actualizado.");
    const equipoId = document.getElementById("crearJugadorEquipoId").value || null;
    if (equipoId) await abrirJugadoresEquipo(equipoId);
  } catch (e) {
    alert(e.message);
  }
}

async function enviarCrearJugador(event) {
  event.preventDefault();

  const equipoId = document.getElementById("crearJugadorEquipoId").value;
  const payload = {
    nombres: document.getElementById("jugadorNombres").value.trim(),
    apellidos: document.getElementById("jugadorApellidos").value.trim(),
    tipoDocumento: document.getElementById("jugadorTipoDocumento").value,
    documento: document.getElementById("jugadorDocumento").value.trim(),
    fechaNacimiento: document.getElementById("jugadorFechaNacimiento").value,
    dorsal: Number(document.getElementById("jugadorDorsal").value),
    posicion: document.getElementById("jugadorPosicion").value,
  };

  if (document.getElementById("jugadorAutorizacionAcudiente").checked) {
    payload.autorizacionAcudiente = true;
  }

  try {
    await api(`/api/teams/equipos/${equipoId}/jugadores`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    document.getElementById("formCrearJugador").reset();
    bootstrap.Modal.getInstance(document.getElementById("modalCrearJugador")).hide();
    alert("Jugador creado correctamente.");
    cargarEquipos();
  } catch (e) {
    alert(e.message);
  }
}

function abrirCrearEquipo() {
  if (!exigirSesion()) return;
  if (usuario.rol !== "delegado") {
    alert("Solo los delegados pueden crear equipos.");
    return;
  }
  bootstrap.Modal.getOrCreateInstance(document.getElementById("modalCrearEquipo")).show();
}

async function enviarCrearEquipo(event) {
  event.preventDefault();
  const nombre = document.getElementById("nuevoEquipoNombre").value.trim();
  const municipio = document.getElementById("nuevoEquipoMunicipio").value.trim();

  if (!nombre || !municipio) {
    alert("Completa nombre y municipio.");
    return;
  }

  try {
    await api("/api/teams/equipos", {
      method: "POST",
      body: JSON.stringify({ nombre, municipio }),
    });
    document.getElementById("formCrearEquipo").reset();
    bootstrap.Modal.getInstance(document.getElementById("modalCrearEquipo")).hide();
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
    if (usuario.rol === "admin") {
      const torneos = (await api("/api/matches/torneos")).torneos || [];
      const todas = [];

      for (const torneo of torneos) {
        try {
          const r = await api(`/api/matches/torneos/${torneo.id}/inscripciones`);
          (r.inscripciones || []).forEach((i) => {
            todas.push({ ...i, torneo: torneo.nombre, torneoId: torneo.id });
          });
        } catch {
          // torneo sin inscripciones visibles o sin permisos
        }
      }

      const visibles = todas.filter((i) => {
        if (filtroInscripcionesAdmin === "pendientes") return i.estado === "pendiente";
        if (filtroInscripcionesAdmin === "aceptadas") return i.estado === "aceptada";
        if (filtroInscripcionesAdmin === "rechazadas") return i.estado === "rechazada";
        return true;
      });

      const resumen = {
        pendientes: todas.filter((i) => i.estado === "pendiente").length,
        aceptadas: todas.filter((i) => i.estado === "aceptada").length,
        rechazadas: todas.filter((i) => i.estado === "rechazada").length,
      };

      cont.innerHTML = `
        <div class="mb-3">
          <div class="d-flex flex-wrap gap-2 mb-3">
            <button class="btn btn-sm ${filtroInscripcionesAdmin === "pendientes" ? "btn-primary" : "btn-outline-primary"}" data-filtro-admin="pendientes">Pendientes (${resumen.pendientes})</button>
            <button class="btn btn-sm ${filtroInscripcionesAdmin === "aceptadas" ? "btn-success" : "btn-outline-success"}" data-filtro-admin="aceptadas">Aceptadas (${resumen.aceptadas})</button>
            <button class="btn btn-sm ${filtroInscripcionesAdmin === "rechazadas" ? "btn-danger" : "btn-outline-danger"}" data-filtro-admin="rechazadas">Rechazadas (${resumen.rechazadas})</button>
            <button class="btn btn-sm ${filtroInscripcionesAdmin === "todas" ? "btn-secondary" : "btn-outline-secondary"}" data-filtro-admin="todas">Todas (${todas.length})</button>
          </div>
        </div>
        ${visibles.length === 0 ? `<div class="alert alert-light border mb-0">No hay inscripciones en este filtro.</div>` : `
          <div class="row g-3">
            ${visibles
              .map(
                (i) => `
                <div class="col-md-6">
                  <div class="card h-100">
                    <div class="card-body">
                      <div class="d-flex justify-content-between align-items-start gap-2 mb-3">
                        <div>
                          <h6 class="mb-1">${i.torneo}</h6>
                          <small class="text-muted">${i.equipo || "Equipo"}</small>
                        </div>
                        ${badge(i.estado)}
                      </div>
                      ${i.motivoDecision ? `<p class="small mb-2 text-muted">Motivo: ${i.motivoDecision}</p>` : ""}
                      ${i.estado === "pendiente" ? `
                        <div class="d-flex gap-2 mt-3">
                          <button class="btn btn-sm btn-success flex-fill" data-aceptar-inscripcion="${i.id}">Aceptar</button>
                          <button class="btn btn-sm btn-outline-danger flex-fill" data-rechazar-inscripcion="${i.id}">Rechazar</button>
                        </div>` : `<div class="mt-3 small text-muted">${i.estado === "aceptada" ? "Aceptada y pendiente de inicio del torneo." : "Rechazada por el administrador."}</div>`}
                    </div>
                  </div>
                </div>`,
              )
              .join("")}
          </div>`}
      `;

      document.querySelectorAll("[data-filtro-admin]").forEach((btn) => {
        btn.addEventListener("click", () => {
          filtroInscripcionesAdmin = btn.dataset.filtroAdmin;
          cargarInscripciones();
        });
      });

      document.querySelectorAll("[data-aceptar-inscripcion]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await api(`/api/matches/inscripciones/${btn.dataset.aceptarInscripcion}/aceptar`, {
              method: "POST",
            });
            alert("Inscripción aceptada.");
            cargarInscripciones();
          } catch (e) {
            alert(e.message);
          }
        });
      });

      document.querySelectorAll("[data-rechazar-inscripcion]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const motivo = prompt("Motivo del rechazo:", "No cumple requisitos");
          if (!motivo) return;
          try {
            await api(`/api/matches/inscripciones/${btn.dataset.rechazarInscripcion}/rechazar`, {
              method: "POST",
              body: JSON.stringify({ motivo }),
            });
            alert("Inscripción rechazada.");
            cargarInscripciones();
          } catch (e) {
            alert(e.message);
          }
        });
      });
      return;
    }

    const r = await api("/api/matches/mis-inscripciones");
    const inscripciones = r.inscripciones || [];
    const filtradas = inscripciones.filter((i) => {
      if (filtroInscripcionesDelegado === "todas") return true;
      return i.estado === filtroInscripcionesDelegado;
    });

    if (inscripciones.length === 0) {
      cont.innerHTML = tarjeta("<p class='mb-0'>No tienes inscripciones. Ve a Torneos e inscribe tu equipo.</p>");
      return;
    }

    cont.innerHTML = `
      <div class="mb-3">
        <label class="form-label">Filtrar</label>
        <select id="filtroMisInscripciones" class="form-select form-select-sm">
          <option value="todas" ${filtroInscripcionesDelegado === "todas" ? "selected" : ""}>Todas</option>
          <option value="pendiente" ${filtroInscripcionesDelegado === "pendiente" ? "selected" : ""}>Pendientes</option>
          <option value="aceptada" ${filtroInscripcionesDelegado === "aceptada" ? "selected" : ""}>Aceptadas</option>
          <option value="rechazada" ${filtroInscripcionesDelegado === "rechazada" ? "selected" : ""}>Rechazadas</option>
        </select>
      </div>
      ${filtradas.length ? `<div class="list-group">${filtradas
        .map(
          (i) => `
          <div class="list-group-item">
            <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap">
              <div>
                <strong>${i.torneo}</strong><br>
                <small>${i.equipo}</small>
              </div>
              ${badge(i.estado)}
            </div>
            <div class="mt-2 small text-muted">
              ${
                i.estado === "pendiente"
                  ? "Esperando la decisión del administrador."
                  : i.estado === "aceptada"
                    ? "Aceptada. Tu equipo ya está confirmado en el torneo."
                    : i.motivoDecision
                      ? `Rechazada: ${i.motivoDecision}`
                      : "Rechazada."
              }
            </div>
          </div>`,
        )
        .join("")}</div>` : "<p class='text-muted mb-0'>No hay inscripciones en ese estado.</p>"}
    `;

    const filtro = document.getElementById("filtroMisInscripciones");
    if (filtro) {
      filtro.addEventListener("change", (event) => {
        filtroInscripcionesDelegado = event.target.value;
        cargarInscripciones();
      });
    }
  } catch (e) {
    cont.innerHTML = tarjeta(`<p class='text-danger mb-0'>${e.message}</p>`);
  }
}

// ---------- home dashboard ----------

async function cargarHome() {
  const cont = document.getElementById("homePublico");
  try {
    const [torneos, equipos, inscripciones, stats] = await Promise.all([
      api("/api/matches/torneos").catch(() => ({ torneos: [] })),
      api("/api/teams/equipos").catch(() => ({ equipos: [] })),
      api("/api/matches/mis-inscripciones").catch(() => ({ inscripciones: [] })),
      api("/api/public/torneos").catch(() => ({ torneos: [] })),
    ]);

    const torneosAdmin = torneos.torneos || [];
    const equiposLista = equipos.equipos || [];
    const inscripcionesLista = inscripciones.inscripciones || [];
    const torneosPublicos = stats.torneos || [];

    const cards = `
      <div class="row g-3 mb-4">
        <div class="col-md-3">
          <div class="card h-100 border-0 bg-success-subtle">
            <div class="card-body text-center">
              <div class="text-success text-uppercase small">Torneos abiertos</div>
              <div class="display-6 fw-bold text-success mt-2">${torneosPublicos.filter((t) => t.estado === "inscripciones_abiertas").length}</div>
            </div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card h-100 border-0 bg-primary-subtle">
            <div class="card-body text-center">
              <div class="text-primary text-uppercase small">${usuario && usuario.rol === "admin" ? "Mis torneos" : "Torneos"}</div>
              <div class="display-6 fw-bold text-primary mt-2">${torneosAdmin.length || torneosPublicos.length}</div>
            </div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card h-100 border-0 bg-warning-subtle">
            <div class="card-body text-center">
              <div class="text-warning-emphasis text-uppercase small">Equipos</div>
              <div class="display-6 fw-bold text-warning-emphasis mt-2">${equiposLista.length}</div>
            </div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card h-100 border-0 bg-info-subtle">
            <div class="card-body text-center">
              <div class="text-info text-uppercase small">Solicitudes</div>
              <div class="display-6 fw-bold text-info mt-2">${inscripcionesLista.filter((i) => i.estado === "pendiente").length}</div>
            </div>
          </div>
        </div>
      </div>
    `;

    const sigue = usuario
      ? `
        <div class="d-flex flex-wrap gap-2 mb-3">
          <button class="btn btn-primary" onclick="location.hash='#torneos'; mostrarVista('torneos');">Ir a torneos</button>
          <button class="btn btn-outline-primary" onclick="location.hash='#equipos'; mostrarVista('equipos');">Ver equipos</button>
        </div>
      `
      : `
        <div class="d-flex flex-wrap gap-2 mb-3">
          <button class="btn btn-primary" onclick="abrirAuth('login')">Iniciar sesión</button>
          <button class="btn btn-outline-primary" onclick="abrirAuth('registro')">Crear cuenta</button>
        </div>
      `;

    cont.innerHTML = `
      ${cards}
      ${sigue}
      <div class="alert alert-light border">
        <strong>Resumen:</strong> ${torneosPublicos.length} torneos publicados, ${torneosPublicos.filter((t) => t.estado === "inscripciones_abiertas").length} abiertos, ${equiposLista.length} equipos y ${inscripcionesLista.filter((i) => i.estado === "pendiente").length} solicitudes pendientes.
      </div>
    `;
  } catch (e) {
    cont.innerHTML = `<div class="alert alert-danger">${e.message}</div>`;
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

// ---------- perfil ----------

async function cargarPerfil() {
  const cont = document.getElementById("perfilContenido");
  if (!usuario) {
    cont.innerHTML = tarjeta("<p class='mb-0'>Inicia sesión para ver tu perfil.</p>");
    return;
  }
  try {
    const r = await api("/api/auth/me");
    usuario = r.usuario;
    localStorage.setItem("gestor_usuario", JSON.stringify(usuario));
    pintarSesion();

    const resumen = usuario.rol === "admin"
      ? [
          { label: "Torneos admin", value: (await api("/api/matches/torneos")).torneos?.length || 0 },
          { label: "Pendientes", value: ((await api("/api/matches/torneos")).torneos || []).reduce((acc, t) => acc + ((t.estado === "inscripciones_abiertas") ? 1 : 0), 0) },
        ]
      : [
          { label: "Equipos", value: ((await api("/api/teams/equipos")).equipos || []).length },
          { label: "Solicitudes", value: ((await api("/api/matches/mis-inscripciones")).inscripciones || []).length },
        ];

    const acciones = usuario.rol === "admin"
      ? `<div class="d-flex flex-wrap gap-2 mt-3">
          <button class="btn btn-primary" onclick="location.hash='#torneos'; mostrarVista('torneos');">Gestionar torneos</button>
          <button class="btn btn-outline-primary" onclick="location.hash='#inscripciones'; mostrarVista('inscripciones');">Revisar inscripciones</button>
        </div>`
      : `<div class="d-flex flex-wrap gap-2 mt-3">
          <button class="btn btn-primary" onclick="location.hash='#equipos'; mostrarVista('equipos');">Mis equipos</button>
          <button class="btn btn-outline-primary" onclick="location.hash='#torneos'; mostrarVista('torneos');">Ver torneos</button>
        </div>`;

    cont.innerHTML = `
      <div class="row g-3">
        <div class="col-lg-5">
          <div class="card h-100">
            <div class="card-body">
              <div class="d-flex align-items-center gap-3 mb-3">
                <div class="rounded-circle bg-primary text-white d-flex align-items-center justify-content-center" style="width:56px;height:56px;font-size:1.4rem;font-weight:700;">
                  ${usuario.nombre?.charAt(0)?.toUpperCase() || "U"}
                </div>
                <div>
                  <h4 class="mb-0">${usuario.nombre}</h4>
                  <small class="text-muted text-uppercase">${usuario.rol}</small>
                </div>
              </div>
              <p class="mb-2"><strong>Correo:</strong> ${usuario.correo}</p>
              <p class="mb-0"><strong>ID:</strong> <code>${usuario.id}</code></p>
              ${acciones}
            </div>
          </div>
        </div>
        <div class="col-lg-7">
          <div class="row g-3">
            ${resumen
              .map(
                (item) => `
                <div class="col-md-6">
                  <div class="card h-100 border-0 bg-light">
                    <div class="card-body text-center">
                      <div class="text-muted text-uppercase small">${item.label}</div>
                      <div class="display-6 fw-bold mt-2">${item.value}</div>
                    </div>
                  </div>
                </div>`,
              )
              .join("")}
          </div>
        </div>
      </div>
    `;
  } catch (e) {
    cont.innerHTML = tarjeta(`<p class='text-danger mb-0'>${e.message}</p>`);
  }
}

// ---------- init ----------

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnLogin").addEventListener("click", () => abrirAuth("login"));
  document.getElementById("btnLogout").addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* la cookie puede no existir */
    }
    cerrarSesionLocal();
    window.location.replace("/login/");
  });

  document.querySelectorAll("#authTabs button").forEach((b) =>
    b.addEventListener("click", () => cambiarTab(b.dataset.tab)),
  );
  document.getElementById("formLogin").addEventListener("submit", enviarLogin);
  document.getElementById("formRegistro").addEventListener("submit", enviarRegistro);

  document.getElementById("btnCrearTorneo").addEventListener("click", abrirCrearTorneo);
  document.getElementById("btnCrearEquipo").addEventListener("click", abrirCrearEquipo);
  document.getElementById("formCrearTorneo").addEventListener("submit", enviarCrearTorneo);
  document.getElementById("formCrearEquipo").addEventListener("submit", enviarCrearEquipo);
  document.getElementById("formCrearJugador").addEventListener("submit", enviarCrearJugador);
  document.getElementById("formEditarJugador").addEventListener("submit", enviarEditarJugador);
  document.getElementById("selectPosiciones").addEventListener("change", mostrarPosiciones);
  document.getElementById("selectEstadisticas").addEventListener("change", mostrarEstadisticas);

  pintarSesion();
    restaurarSesion().then(() => {
    if (!token || !usuario) {
    window.location.replace("/login/");
    return;
    }

    pintarSesion();
    cargarPerfil();
    mostrarVista(location.hash.slice(1) || "home");
  });
});
