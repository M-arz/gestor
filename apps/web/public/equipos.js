/**
 * GESTOR · Equipos con mini cancha (vista delegado)
 *
 * Cargar DESPUÉS de app.js. Redefine estas funciones de app.js:
 *   cargarEquipos, enviarCrearEquipo, abrirCrearJugador,
 *   abrirEditarJugador, enviarEditarJugador
 * "Ver jugadores" (abrirJugadoresEquipo) sigue igual.
 */

// Formaciones: cuántos titulares por línea y cuántos puestos de suplentes.
// Cambia los números aquí si quieres otra formación.
const FORMATOS_EQUIPO = {
  futbol_5:  { etiqueta: "Fútbol 5",  suplentes: 3, lineas: { delantero: 2, mediocampista: 0, defensa: 2, portero: 1 } },
  futbol_9:  { etiqueta: "Fútbol 9",  suplentes: 5, lineas: { delantero: 2, mediocampista: 3, defensa: 3, portero: 1 } },
  futbol_11: { etiqueta: "Fútbol 11", suplentes: 7, lineas: { delantero: 2, mediocampista: 4, defensa: 4, portero: 1 } },
};
const ORDEN_LINEAS = ["delantero", "mediocampista", "defensa", "portero"]; // de arriba a abajo
const ABREVIATURA_POSICION = { portero: "POR", defensa: "DEF", mediocampista: "MED", delantero: "DEL" };
const TIPOS_LOCALES_KEY = "gestor_tipos_equipo";

let equiposCache = {};
let jugadoresCache = {};
let editarDesdeLista = false;

// ---------- utilidades ----------

function esc(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

// Respaldo mientras el backend no devuelva el tipo del equipo.
function leerTiposLocales() {
  try {
    return JSON.parse(localStorage.getItem(TIPOS_LOCALES_KEY) || "{}");
  } catch {
    return {};
  }
}

function guardarTipoLocal(id, tipo) {
  if (!id) return;
  const mapa = leerTiposLocales();
  mapa[id] = tipo;
  try {
    localStorage.setItem(TIPOS_LOCALES_KEY, JSON.stringify(mapa));
  } catch {
    /* almacenamiento no disponible */
  }
}

function tipoDeEquipo(equipo) {
  const tipo = equipo.tipoEquipo || equipo.tipo || leerTiposLocales()[equipo.id];
  return FORMATOS_EQUIPO[tipo] ? tipo : "futbol_11";
}

// ---------- mini cancha ----------

function distribuirJugadores(tipo, jugadores) {
  const formato = FORMATOS_EQUIPO[tipo];
  const ordenados = [...jugadores].sort((a, b) => (a.dorsal ?? 99) - (b.dorsal ?? 99));
  const resto = [];

  const filas = ORDEN_LINEAS.filter((pos) => formato.lineas[pos] > 0).map((pos) => {
    const cupos = formato.lineas[pos];
    const delPuesto = ordenados.filter((j) => j.posicion === pos);
    resto.push(...delPuesto.slice(cupos));
    return {
      posicion: pos,
      slots: Array.from({ length: cupos }, (_, i) => delPuesto[i] || null),
    };
  });

  resto.push(...ordenados.filter((j) => !ORDEN_LINEAS.includes(j.posicion)));
  const total = Math.max(formato.suplentes, resto.length);
  const suplentes = Array.from({ length: total }, (_, i) => resto[i] || null);

  const titulares = filas.reduce((acc, f) => acc + f.slots.filter(Boolean).length, 0);
  const cupoTitulares = filas.reduce((acc, f) => acc + f.slots.length, 0);
  return { filas, suplentes, titulares, cupoTitulares };
}

function slotHtml(jugador, posicion, equipoId) {
  if (jugador) {
    const apellido = (jugador.apellidos || "").trim().split(" ")[0] || jugador.nombres;
    const estado = jugador.habilitado === false ? " slot-inhabilitado" : "";
    return `
      <button type="button" class="slot-jugador slot-ocupado${estado}"
        data-slot-editar="${esc(jugador.id)}" data-equipo="${esc(equipoId)}"
        title="${esc(`${jugador.nombres} ${jugador.apellidos}`)}">
        <span class="slot-circulo">${esc(jugador.dorsal ?? "-")}</span>
        <span class="slot-nombre">${esc(apellido)}</span>
      </button>`;
  }
  const abrev = ABREVIATURA_POSICION[posicion] || "SUP";
  return `
    <button type="button" class="slot-jugador slot-vacio"
      data-slot-agregar="${esc(posicion)}" data-equipo="${esc(equipoId)}"
      aria-label="Agregar jugador (${abrev})">
      <span class="slot-circulo">+</span>
      <span class="slot-nombre">${abrev}</span>
    </button>`;
}

function tarjetaEquipoCancha(equipo) {
  const tipo = tipoDeEquipo(equipo);
  const { filas, suplentes, titulares, cupoTitulares } = distribuirJugadores(tipo, jugadoresCache[equipo.id] || []);
  const totalJugadores = (jugadoresCache[equipo.id] || []).length;

  return `
    <div class="col-md-6 col-xl-4">
      <div class="card equipo-card h-100">
        <div class="card-body d-flex flex-column">
          <div class="d-flex justify-content-between align-items-start gap-2 mb-3">
            <div>
              <h5 class="card-title mb-0">${esc(equipo.nombre)}</h5>
              <small class="text-muted">${esc(equipo.municipio || "")}</small>
            </div>
            <span class="badge equipo-tipo">${FORMATOS_EQUIPO[tipo].etiqueta}</span>
          </div>

          <div class="mini-cancha">
            <span class="cancha-linea-centro"></span>
            <span class="cancha-circulo"></span>
            <span class="cancha-area cancha-area-sup"></span>
            <span class="cancha-area cancha-area-inf"></span>
            ${filas
              .map(
                (f) => `<div class="cancha-fila">${f.slots.map((j) => slotHtml(j, f.posicion, equipo.id)).join("")}</div>`,
              )
              .join("")}
          </div>

          <div class="suplentes">
            <span class="suplentes-titulo">SUPLENTES</span>
            <div class="suplentes-lista">${suplentes.map((j) => slotHtml(j, j?.posicion || "", equipo.id)).join("")}</div>
          </div>

          <div class="mt-3 d-flex justify-content-between align-items-center gap-2">
            <small class="text-muted">${titulares}/${cupoTitulares} titulares · ${totalJugadores} jugadores</small>
            <button class="btn btn-sm btn-outline-primary" data-ver-jugadores="${esc(equipo.id)}">Ver jugadores</button>
          </div>
        </div>
      </div>
    </div>`;
}

function tarjetaEquipoSimple(equipo) {
  return `
    <div class="col-md-4">
      <div class="card h-100">
        <div class="card-body d-flex flex-column">
          <h5 class="card-title">${esc(equipo.nombre)}</h5>
          <p class="card-text text-muted">${esc(equipo.municipio || "")}</p>
          <div class="mt-auto">
            <button class="btn btn-sm btn-outline-primary" data-ver-jugadores="${esc(equipo.id)}">Ver jugadores</button>
          </div>
        </div>
      </div>
    </div>`;
}

// ---------- vista de equipos ----------

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

    const esDelegado = usuario.rol === "delegado";
    equiposCache = Object.fromEntries(equipos.map((e) => [e.id, e]));

    if (esDelegado) {
      const pares = await Promise.all(
        equipos.map(async (e) => {
          try {
            const jr = await api(`/api/teams/equipos/${e.id}/jugadores`);
            return [e.id, jr.jugadores || []];
          } catch {
            return [e.id, []];
          }
        }),
      );
      jugadoresCache = Object.fromEntries(pares);
    }

    cont.innerHTML = `<div class="row g-3">${equipos
      .map((e) => (esDelegado ? tarjetaEquipoCancha(e) : tarjetaEquipoSimple(e)))
      .join("")}</div>`;

    document.querySelectorAll("[data-ver-jugadores]").forEach((btn) => {
      btn.addEventListener("click", () => abrirJugadoresEquipo(btn.dataset.verJugadores));
    });

    document.querySelectorAll("[data-slot-agregar]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const equipoId = btn.dataset.equipo;
        abrirCrearJugador(equipoId, equiposCache[equipoId]?.nombre, btn.dataset.slotAgregar);
      });
    });

    document.querySelectorAll("[data-slot-editar]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const equipoId = btn.dataset.equipo;
        const jugador = (jugadoresCache[equipoId] || []).find((j) => String(j.id) === btn.dataset.slotEditar);
        if (!jugador) return;
        document.getElementById("crearJugadorEquipoId").value = equipoId;
        abrirEditarJugador(jugador, false);
      });
    });
  } catch (e) {
    cont.innerHTML = tarjeta(`<p class='text-danger mb-0'>${esc(e.message)}</p>`);
  }
}

// ---------- crear equipo ----------

async function enviarCrearEquipo(event) {
  event.preventDefault();
  const nombre = document.getElementById("nuevoEquipoNombre").value.trim();
  const municipio = document.getElementById("nuevoEquipoMunicipio").value;
  const tipoEquipo = document.getElementById("nuevoEquipoTipo").value;

  if (!nombre || !municipio || !tipoEquipo) {
    alert("Completa nombre, municipio y tipo de equipo.");
    return;
  }

  try {
    const r = await api("/api/teams/equipos", {
      method: "POST",
      body: JSON.stringify({ nombre, municipio, tipoEquipo }),
    });
    const creado = r?.equipo || r;
    guardarTipoLocal(creado?.id, tipoEquipo);

    document.getElementById("formCrearEquipo").reset();
    bootstrap.Modal.getInstance(document.getElementById("modalCrearEquipo"))?.hide();
    cargarEquipos();
  } catch (e) {
    alert(e.message);
  }
}

// ---------- jugadores (desde la cancha o desde la lista) ----------

function abrirCrearJugador(equipoId, nombre = "equipo", posicion = "") {
  if (!exigirSesion()) return;
  if (usuario.rol !== "delegado") {
    alert("Solo los delegados pueden crear jugadores.");
    return;
  }

  document.getElementById("crearJugadorEquipoId").value = equipoId;
  document.getElementById("crearJugadorTitulo").textContent = `Crear jugador · ${nombre}`;
  document.getElementById("formCrearJugador").reset();
  if (posicion) document.getElementById("jugadorPosicion").value = posicion;
  bootstrap.Modal.getOrCreateInstance(document.getElementById("modalCrearJugador")).show();
}

function abrirEditarJugador(jugador, desdeLista = true) {
  editarDesdeLista = desdeLista;
  document.getElementById("editarJugadorId").value = jugador.id;
  document.getElementById("editarJugadorNombres").value = jugador.nombres || "";
  document.getElementById("editarJugadorApellidos").value = jugador.apellidos || "";
  document.getElementById("editarJugadorDorsal").value = jugador.dorsal ?? 0;
  document.getElementById("editarJugadorPosicion").value = jugador.posicion || "delantero";
  document.getElementById("editarJugadorHabilitado").value = String(Boolean(jugador.habilitado));
  if (desdeLista) {
    bootstrap.Modal.getInstance(document.getElementById("modalJugadoresEquipo"))?.hide();
  }
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
    bootstrap.Modal.getInstance(document.getElementById("modalEditarJugador"))?.hide();
    alert("Jugador actualizado.");
    const equipoId = document.getElementById("crearJugadorEquipoId").value || null;
    await cargarEquipos();
    if (editarDesdeLista && equipoId) await abrirJugadoresEquipo(equipoId);
  } catch (e) {
    alert(e.message);
  }
}