/**
 * GESTOR · Sección "Partidos" (admin y delegado)
 *
 * Cargar DESPUÉS de app.js, equipos.js, dashboard.js y dialogos.js.
 * Crea sola el enlace del menú y la sección (no hay que editar el HTML) y
 * redefine mostrarVista() para incluir la vista "partidos".
 *
 *  - Delegado: calendario y resultados de los torneos donde su equipo fue
 *    aceptado (sus partidos resaltados) + detalle. Solo lectura.
 *  - Admin: además programa, edita, cancela y registra resultados.
 */

// Valores de TIPOS_EVENTO y FASES de matches/src/dominio.ts
const TIPOS_EVENTO_PARTIDO = [
  ["gol", "Gol"],
  ["autogol", "Autogol"],
  ["asistencia", "Asistencia"],
  ["amarilla", "Tarjeta amarilla"],
  ["roja", "Tarjeta roja"],
];
const FASES_PARTIDO = [
  ["grupos", "Fase de grupos"],
  ["liguilla", "Liguilla"],
  ["eliminatoria", "Eliminatoria"],
];

const COLOR_ESTADO_PARTIDO = {
  programado: "bg-info text-dark",
  en_juego: "bg-primary",
  finalizado: "bg-success",
  aplazado: "bg-warning text-dark",
  cancelado: "bg-danger",
};

const partidosCtx = { torneoId: "", partidos: [], inscripciones: [], plantillas: {}, equiposPropios: new Set(), grupos: [] };

const porId = (id) => document.getElementById(id);

// ---------- utilidades ----------

function badgePartido(estado) {
  return `<span class="badge ${COLOR_ESTADO_PARTIDO[estado] || "bg-secondary"}">${esc(estado || "-")}</span>`;
}

function textoFecha(iso) {
  if (!iso) return "Por programar";
  return new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
}

function aInputFecha(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function marcadorPartido(p) {
  return p.golesLocal != null && p.golesVisitante != null ? `${p.golesLocal} - ${p.golesVisitante}` : "vs";
}

// ---------- montaje: menú y sección ----------

function montarSeccionPartidos() {
  if (porId("partidos")) return;

  document
    .querySelector('#menu a[href="#inscripciones"]')
    ?.insertAdjacentHTML(
      "afterend",
      '<a class="list-group-item list-group-item-action" href="#partidos" data-bs-dismiss="offcanvas">Partidos</a>',
    );

  // Bootstrap cancela la navegación de los enlaces con data-bs-dismiss; app.js cambia el hash
  // a mano para los demás, así que aquí se hace lo mismo.
  document.querySelector('#menu a[href="#partidos"]')?.addEventListener("click", () => {
    window.location.hash = "#partidos";
  });

  porId("inscripciones").insertAdjacentHTML(
    "afterend",
    `
    <section id="partidos" class="vista d-none">
      <div class="d-flex justify-content-between align-items-end flex-wrap gap-3 mb-4">
        <div class="vista-encabezado">
          <span class="eyebrow">CALENDARIO</span>
          <h2>Partidos</h2>
        </div>
        <button class="btn btn-success" id="btnProgramarPartido" style="display:none;">Programar partido</button>
      </div>

      <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
        <select id="selectPartidosTorneo" class="form-select" style="max-width:320px;"></select>
        <select id="selectPartidosEstado" class="form-select" style="max-width:200px;">
          <option value="">Todos los estados</option>
          <option value="programado">Programados</option>
          <option value="en_juego">En juego</option>
          <option value="finalizado">Finalizados</option>
          <option value="aplazado">Aplazados</option>
          <option value="cancelado">Cancelados</option>
        </select>
        <div class="form-check ms-2" id="soloMiosWrap" style="display:none;">
          <input class="form-check-input" type="checkbox" id="chkSoloMios">
          <label class="form-check-label" for="chkSoloMios">Solo mis partidos</label>
        </div>
      </div>

      <div id="listaPartidos"></div>
    </section>`,
  );

  porId("selectPartidosTorneo").addEventListener("change", cargarPartidosTorneo);
  porId("selectPartidosEstado").addEventListener("change", cargarPartidosTorneo);
  porId("chkSoloMios").addEventListener("change", renderPartidos);
  porId("btnProgramarPartido").addEventListener("click", programarPartido);

  porId("listaPartidos").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-accion]");
    if (!btn) return;
    const p = partidosCtx.partidos.find((x) => String(x.id) === btn.dataset.id);
    if (!p) return;
    const acciones = {
      detalle: verDetallePartido,
      resultado: registrarResultadoPartido,
      editar: editarPartido,
      cancelar: cancelarPartido,
    };
    acciones[btn.dataset.accion]?.(p);
  });
}

// Igual que la de app.js, con la vista "partidos" añadida.
function mostrarVista(nombre) {
  const validas = ["home", "torneos", "equipos", "inscripciones", "partidos", "posiciones", "estadisticas", "perfil"];
  const vista = validas.includes(nombre) ? nombre : "home";
  document.querySelectorAll(".vista").forEach((s) => s.classList.add("d-none"));
  porId(vista).classList.remove("d-none");
  document.querySelectorAll("#menu .list-group-item").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("href") === `#${vista}`);
  });

  if (vista === "home") cargarHome();
  if (vista === "torneos") cargarTorneos();
  if (vista === "equipos") cargarEquipos();
  if (vista === "inscripciones") cargarInscripciones();
  if (vista === "partidos") cargarPartidos();
  if (vista === "posiciones") cargarSelectorPosiciones();
  if (vista === "estadisticas") cargarSelectorEstadisticas();
  if (vista === "perfil") cargarPerfil();
}

// ---------- carga de datos ----------

async function cargarPartidos() {
  const sel = porId("selectPartidosTorneo");
  const cont = porId("listaPartidos");
  const esAdmin = usuario?.rol === "admin";
  porId("btnProgramarPartido").style.display = "none";
  porId("soloMiosWrap").style.display = "none";

  if (!usuario) {
    sel.innerHTML = "";
    cont.innerHTML = tarjeta("<p class='mb-0'>Inicia sesión para ver los partidos.</p>");
    return;
  }

  try {
    let torneos = [];
    if (esAdmin) {
      torneos = (await api("/api/matches/torneos")).torneos || [];
    } else {
      const ins = (await api("/api/matches/mis-inscripciones")).inscripciones || [];
      const aceptadas = ins.filter((i) => i.estado === "aceptada");
      partidosCtx.equiposPropios = new Set(aceptadas.map((i) => i.equipo));
      torneos = [...new Map(aceptadas.map((i) => [i.torneoId, { id: i.torneoId, nombre: i.torneo }])).values()];
    }

    if (torneos.length === 0) {
      sel.innerHTML = "";
      cont.innerHTML = tarjeta(
        `<p class="mb-0">${esAdmin ? "Todavía no administras ningún torneo." : "Tu equipo aún no está aceptado en ningún torneo."}</p>`,
      );
      return;
    }

    const previo = sel.value;
    sel.innerHTML = torneos.map((t) => `<option value="${esc(t.id)}">${esc(t.nombre)}</option>`).join("");
    if (torneos.some((t) => t.id === previo)) sel.value = previo;
    porId("soloMiosWrap").style.display = esAdmin ? "none" : "block";
    await cargarPartidosTorneo();
  } catch (e) {
    cont.innerHTML = tarjeta(`<p class="text-danger mb-0">${esc(e.message)}</p>`);
  }
}

async function cargarPartidosTorneo() {
  const torneoId = porId("selectPartidosTorneo").value;
  const estado = porId("selectPartidosEstado").value;
  if (!torneoId) return;

  try {
    const r = await api(`/api/public/torneos/${torneoId}/partidos${estado ? `?estado=${estado}` : ""}`);
    partidosCtx.torneoId = torneoId;
    partidosCtx.partidos = r.partidos || [];
    partidosCtx.plantillas = {};
    if (usuario.rol === "admin") {
      partidosCtx.inscripciones = (await api(`/api/matches/torneos/${torneoId}/inscripciones`)).inscripciones || [];
      partidosCtx.grupos = (await api(`/api/matches/torneos/${torneoId}/grupos`).catch(() => ({ grupos: [] }))).grupos || [];
    }
    renderPartidos();
  } catch (e) {
    porId("listaPartidos").innerHTML = tarjeta(`<p class="text-danger mb-0">${esc(e.message)}</p>`);
  }
}

// ---------- pintar la lista ----------

function filaPartido(p, esAdmin, propio) {
  const id = esc(p.id);
  const botones = [`<button class="btn btn-sm btn-outline-primary" data-accion="detalle" data-id="${id}">Detalle</button>`];
  if (esAdmin && p.estado !== "cancelado") {
    botones.push(
      `<button class="btn btn-sm btn-outline-primary" data-accion="resultado" data-id="${id}">${p.estado === "finalizado" ? "Editar resultado" : "Resultado"}</button>`,
      `<button class="btn btn-sm btn-outline-primary" data-accion="editar" data-id="${id}">Editar</button>`,
      `<button class="btn btn-sm btn-outline-primary" data-accion="cancelar" data-id="${id}">Cancelar</button>`,
    );
  }

  return `
    <div class="partido-fila ${propio ? "partido-propio" : ""}">
      <div class="partido-equipos">
        <span class="partido-equipo partido-local">${esc(p.local?.nombre)}</span>
        <span class="partido-marcador">${marcadorPartido(p)}</span>
        <span class="partido-equipo">${esc(p.visitante?.nombre)}</span>
      </div>
      <div class="partido-meta">
        <span>${esc(textoFecha(p.fechaHora))}</span>
        ${p.cancha ? `<span>· ${esc(p.cancha)}</span>` : ""}
        ${badgePartido(p.estado)}
      </div>
      <div class="partido-acciones">${botones.join("")}</div>
    </div>`;
}

function renderPartidos() {
  const cont = porId("listaPartidos");
  const esAdmin = usuario.rol === "admin";
  porId("btnProgramarPartido").style.display = esAdmin ? "inline-block" : "none";

  const esPropio = (p) =>
    partidosCtx.equiposPropios.has(p.local?.nombre) || partidosCtx.equiposPropios.has(p.visitante?.nombre);
  let lista = partidosCtx.partidos;
  if (!esAdmin && porId("chkSoloMios").checked) lista = lista.filter(esPropio);

  if (lista.length === 0) {
    cont.innerHTML = tarjeta("<p class='mb-0'>No hay partidos para mostrar con este filtro.</p>");
    return;
  }

  const porJornada = new Map();
  [...lista]
    .sort(
      (a, b) =>
        (a.jornada ?? 999) - (b.jornada ?? 999) || String(a.fechaHora ?? "z").localeCompare(String(b.fechaHora ?? "z")),
    )
    .forEach((p) => {
      const clave = p.jornada ?? 0;
      if (!porJornada.has(clave)) porJornada.set(clave, []);
      porJornada.get(clave).push(p);
    });

  const todos = partidosCtx.partidos;
  cont.innerHTML = `
    <div class="gestor-dashboard">
      <div class="gestor-summary-grid">
        <div class="gestor-summary-card dark"><span>Partidos</span><strong>${todos.length}</strong></div>
        <div class="gestor-summary-card primary"><span>Programados</span><strong>${todos.filter((p) => p.estado === "programado").length}</strong></div>
        <div class="gestor-summary-card success"><span>Finalizados</span><strong>${todos.filter((p) => p.estado === "finalizado").length}</strong></div>
      </div>
      ${[...porJornada.entries()]
        .map(
          ([jornada, partidos]) => `
          <div class="gestor-panel">
            <h6 class="jornada-titulo">${jornada ? `Jornada ${jornada}` : "Sin jornada"}</h6>
            ${partidos.map((p) => filaPartido(p, esAdmin, !esAdmin && esPropio(p))).join("")}
          </div>`,
        )
        .join("")}
    </div>`;
}

// ---------- detalle (todos) ----------

async function verDetallePartido(p) {
  try {
    const d = await api(`/api/matches/partidos/${p.id}`);
    const partido = d.partido || d;
    const eventos = d.eventos || partido.eventos || [];
    const etiqueta = Object.fromEntries(TIPOS_EVENTO_PARTIDO);

    const filas = eventos
      .map((ev) => {
        const quien = ev.jugador?.nombre || ev.jugadorNombre || ev.nombre || ev.jugador || "";
        return `<li class="list-group-item d-flex justify-content-between gap-2">
          <span>${esc(ev.minuto ?? "")}' · ${esc(etiqueta[ev.tipo] || ev.tipo)}</span>
          <strong>${esc(quien)}</strong>
        </li>`;
      })
      .join("");

    await dialogo({
      titulo: "Detalle del partido",
      sinConfirmar: true,
      cuerpo: `
        <div class="partido-equipos mb-2">
          <span class="partido-equipo partido-local">${esc(p.local?.nombre)}</span>
          <span class="partido-marcador">${marcadorPartido(p)}</span>
          <span class="partido-equipo">${esc(p.visitante?.nombre)}</span>
        </div>
        <p class="text-center text-muted mb-3">
          ${esc(textoFecha(p.fechaHora))}${p.cancha ? ` · ${esc(p.cancha)}` : ""}${p.jornada ? ` · Jornada ${esc(p.jornada)}` : ""}
          ${badgePartido(p.estado)}
        </p>
        <h6>Eventos</h6>
        ${filas ? `<ul class="list-group">${filas}</ul>` : "<p class='text-muted mb-0'>Sin eventos registrados.</p>"}`,
    });
  } catch (e) {
    alert(e.message);
  }
}

// ---------- programar, editar y cancelar (admin) ----------

async function programarPartido() {
  const aceptadas = partidosCtx.inscripciones.filter((i) => i.estado === "aceptada");
  if (aceptadas.length < 2) {
    alert("Necesitas al menos dos equipos aceptados para programar un partido.");
    return;
  }
  const opciones = aceptadas.map((i) => `<option value="${esc(i.id)}">${esc(i.equipo)}</option>`).join("");

  const datos = await dialogo({
    titulo: "Programar partido",
    confirmar: "Programar",
    validar: (d) => (d.local === d.visitante ? "El equipo local y el visitante deben ser distintos." : null),
    cuerpo: `
      <div class="row g-3">
        <div class="col-md-6">
          <label class="form-label" for="dlgLocal">Equipo local</label>
          <select class="form-select" id="dlgLocal" name="local" required>
            <option value="" selected disabled>Selecciona</option>${opciones}
          </select>
        </div>
        <div class="col-md-6">
          <label class="form-label" for="dlgVisitante">Equipo visitante</label>
          <select class="form-select" id="dlgVisitante" name="visitante" required>
            <option value="" selected disabled>Selecciona</option>${opciones}
          </select>
        </div>
        <div class="col-md-4">
          <label class="form-label" for="dlgJornada">Jornada</label>
          <input type="number" class="form-control" id="dlgJornada" name="jornada" min="1" max="100">
        </div>
        <div class="col-md-8">
          <label class="form-label" for="dlgFecha">Fecha y hora</label>
          <input type="datetime-local" class="form-control" id="dlgFecha" name="fechaHora">
        </div>
        <div class="col-md-6">
          <label class="form-label" for="dlgFase">Fase</label>
          <select class="form-select" id="dlgFase" name="fase">
            <option value="">Sin definir</option>
            ${FASES_PARTIDO.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
          </select>
        </div>
        <div class="col-md-6">
          <label class="form-label" for="dlgGrupo">Grupo</label>
          <select class="form-select" id="dlgGrupo" name="grupo">
            <option value="">Sin grupo</option>
            ${partidosCtx.grupos.map((g) => `<option value="${esc(g.id)}">${esc(g.nombre)}</option>`).join("")}
          </select>
        </div>
        <div class="col-12">
          <label class="form-label" for="dlgCancha">Cancha</label>
          <input type="text" class="form-control" id="dlgCancha" name="cancha" maxlength="80">
        </div>
      </div>`,
  });
  if (!datos) return;

  const body = { inscripcionLocalId: datos.local, inscripcionVisitanteId: datos.visitante };
  if (datos.jornada) body.jornada = Number(datos.jornada);
  if (datos.fechaHora) body.fechaHora = new Date(datos.fechaHora).toISOString();
  if (datos.cancha.trim()) body.cancha = datos.cancha.trim();
  if (datos.fase) body.fase = datos.fase;
  if (datos.grupo) body.grupoId = datos.grupo;

  try {
    await api(`/api/matches/torneos/${partidosCtx.torneoId}/partidos`, { method: "POST", body: JSON.stringify(body) });
    alert("Partido programado.");
    await cargarPartidosTorneo();
  } catch (e) {
    alert(e.message);
  }
}

async function editarPartido(p) {
  const datos = await dialogo({
    titulo: "Editar partido",
    confirmar: "Guardar cambios",
    cuerpo: `
      <p class="mb-3"><strong>${esc(p.local?.nombre)}</strong> vs <strong>${esc(p.visitante?.nombre)}</strong></p>
      <div class="row g-3">
        <div class="col-md-4">
          <label class="form-label" for="dlgJornada">Jornada</label>
          <input type="number" class="form-control" id="dlgJornada" name="jornada" min="1" max="100" value="${esc(p.jornada ?? "")}">
        </div>
        <div class="col-md-8">
          <label class="form-label" for="dlgFecha">Fecha y hora</label>
          <input type="datetime-local" class="form-control" id="dlgFecha" name="fechaHora" value="${aInputFecha(p.fechaHora)}">
        </div>
        <div class="col-12">
          <label class="form-label" for="dlgCancha">Cancha</label>
          <input type="text" class="form-control" id="dlgCancha" name="cancha" maxlength="80" value="${esc(p.cancha ?? "")}">
        </div>
      </div>`,
  });
  if (!datos) return;

  try {
    await api(`/api/matches/partidos/${p.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        fechaHora: datos.fechaHora ? new Date(datos.fechaHora).toISOString() : null,
        cancha: datos.cancha.trim() || null,
        jornada: datos.jornada ? Number(datos.jornada) : null,
      }),
    });
    alert("Partido actualizado.");
    await cargarPartidosTorneo();
  } catch (e) {
    alert(e.message);
  }
}

async function cancelarPartido(p) {
  const datos = await dialogo({
    titulo: "Cancelar partido",
    confirmar: "Cancelar partido",
    tipoBoton: "danger",
    cuerpo: `
      <p><strong>${esc(p.local?.nombre)}</strong> vs <strong>${esc(p.visitante?.nombre)}</strong></p>
      <label class="form-label" for="dlgMotivo">Motivo (opcional)</label>
      <textarea class="form-control" id="dlgMotivo" name="motivo" rows="2" maxlength="200"></textarea>`,
  });
  if (!datos) return;

  try {
    const motivo = datos.motivo.trim();
    await api(`/api/matches/partidos/${p.id}/cancelar`, {
      method: "POST",
      body: JSON.stringify(motivo ? { motivo } : {}),
    });
    alert("Partido cancelado.");
    await cargarPartidosTorneo();
  } catch (e) {
    alert(e.message);
  }
}

// ---------- registrar resultado (admin) ----------

function inscripcionDelLado(p, lado) {
  const mayus = lado === "local" ? "Local" : "Visitante";
  const directo = p[`inscripcion${mayus}Id`] ?? p[lado]?.inscripcionId;
  if (directo) return directo;
  return partidosCtx.inscripciones.find((i) => i.equipo === p[lado]?.nombre)?.id;
}

async function plantillaDe(inscripcionId) {
  if (!partidosCtx.plantillas[inscripcionId]) {
    const r = await api(`/api/matches/inscripciones/${inscripcionId}/plantilla`);
    partidosCtx.plantillas[inscripcionId] = (r.plantilla || []).filter((j) => !j.estado || j.estado === "habilitado");
  }
  return partidosCtx.plantillas[inscripcionId];
}

async function registrarResultadoPartido(p) {
  try {
    const idLocal = inscripcionDelLado(p, "local");
    const idVisitante = inscripcionDelLado(p, "visitante");
    if (!idLocal || !idVisitante) throw new Error("No se encontró la inscripción de alguno de los equipos.");

    const [plantillaLocal, plantillaVisitante] = await Promise.all([plantillaDe(idLocal), plantillaDe(idVisitante)]);

    // Eventos ya registrados (para no perderlos al editar el resultado)
    let previos = [];
    try {
      const d = await api(`/api/matches/partidos/${p.id}`);
      const evs = d.eventos || d.partido?.eventos || [];
      previos = evs
        .filter((ev) => ev.tipo && ev.jugadorId)
        .map((ev) => ({ tipo: ev.tipo, jugadorId: ev.jugadorId, minuto: ev.minuto ?? 0 }));
    } catch {
      /* sin detalle previo */
    }

    const grupo = (lista, equipo) =>
      `<optgroup label="${esc(equipo)}">${lista
        .map((j) => `<option value="${esc(j.jugadorId)}">#${esc(j.dorsal ?? "-")} ${esc(j.nombre)}</option>`)
        .join("")}</optgroup>`;
    const opcionesJugadores = grupo(plantillaLocal, p.local?.nombre) + grupo(plantillaVisitante, p.visitante?.nombre);

    const filaEvento = `
      <div class="row g-2 evento-fila">
        <div class="col-4">
          <select class="form-select form-select-sm" data-ev="tipo">
            ${TIPOS_EVENTO_PARTIDO.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
          </select>
        </div>
        <div class="col-5">
          <select class="form-select form-select-sm" data-ev="jugador" required>
            <option value="" selected disabled>Jugador</option>${opcionesJugadores}
          </select>
        </div>
        <div class="col-2">
          <input type="number" class="form-control form-control-sm" data-ev="minuto" min="0" max="130" value="0" required aria-label="Minuto">
        </div>
        <div class="col-1">
          <button type="button" class="btn btn-sm btn-outline-danger w-100 px-0" data-ev-quitar aria-label="Quitar evento">×</button>
        </div>
      </div>`;

    const datos = await dialogo({
      titulo: "Registrar resultado",
      confirmar: "Guardar resultado",
      tamano: "lg",
      cuerpo: `
        <div class="row g-3 align-items-end mb-4">
          <div class="col-5">
            <label class="form-label" for="dlgGolesLocal">${esc(p.local?.nombre)}</label>
            <input type="number" class="form-control" id="dlgGolesLocal" name="golesLocal" min="0" max="99" value="${esc(p.golesLocal ?? 0)}" required>
          </div>
          <div class="col-2 text-center fw-bold pb-2">-</div>
          <div class="col-5">
            <label class="form-label" for="dlgGolesVisitante">${esc(p.visitante?.nombre)}</label>
            <input type="number" class="form-control" id="dlgGolesVisitante" name="golesVisitante" min="0" max="99" value="${esc(p.golesVisitante ?? 0)}" required>
          </div>
        </div>
        <div class="d-flex justify-content-between align-items-center mb-2">
          <h6 class="mb-0">Eventos (goles, asistencias y tarjetas)</h6>
          <button type="button" class="btn btn-sm btn-outline-primary" data-ev-agregar>Añadir evento</button>
        </div>
        <div class="d-grid gap-2" data-ev-lista></div>`,
      recoger: (form) => ({
        golesLocal: Number(form.golesLocal.value),
        golesVisitante: Number(form.golesVisitante.value),
        eventos: [...form.querySelectorAll(".evento-fila")].map((f) => ({
          tipo: f.querySelector('[data-ev="tipo"]').value,
          jugadorId: f.querySelector('[data-ev="jugador"]').value,
          minuto: Number(f.querySelector('[data-ev="minuto"]').value),
        })),
      }),
      alAbrir: (el) => {
        const lista = el.querySelector("[data-ev-lista]");
        const agregar = (ev) => {
          lista.insertAdjacentHTML("beforeend", filaEvento);
          const fila = lista.lastElementChild;
          if (ev) {
            fila.querySelector('[data-ev="tipo"]').value = ev.tipo;
            fila.querySelector('[data-ev="jugador"]').value = ev.jugadorId;
            fila.querySelector('[data-ev="minuto"]').value = ev.minuto;
          }
        };
        previos.forEach(agregar);
        el.querySelector("[data-ev-agregar]").addEventListener("click", () => agregar());
        lista.addEventListener("click", (e) => e.target.closest("[data-ev-quitar]")?.closest(".evento-fila").remove());
      },
    });
    if (!datos) return;

    await api(`/api/matches/partidos/${p.id}/resultado`, { method: "PUT", body: JSON.stringify(datos) });
    alert("Resultado registrado.");
    await cargarPartidosTorneo();
  } catch (e) {
    alert(e.message);
  }
}

montarSeccionPartidos();