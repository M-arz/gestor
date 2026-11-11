/**
 * GESTOR · Sin alert() ni prompt() ni confirm()
 *
 * Cargar DESPUÉS de app.js, equipos.js y dashboard.js. No hay que tocar app.js.
 *  - alert(...)  → aviso (toast) que no bloquea la pantalla.
 *  - Inscribirse, rechazar inscripción, generar grupos, corregir documento y
 *    retirar jugador → ventanas (modales) con el mismo estilo del dashboard.
 */

// ---------- avisos (reemplazan a alert) ----------

const MENSAJES_OK = /(creado|creada|actualizado|aceptada|rechazada|generados?|agregado|retirado|corregido|enviada|guardado|registrad[oa]|programad[oa]|cancelad[oa])/i;

function mostrarToast(mensaje, tipo = "success") {
  let cont = document.getElementById("toastContainer");
  if (!cont) {
    cont = document.createElement("div");
    cont.id = "toastContainer";
    cont.className = "toast-container position-fixed bottom-0 end-0 p-3";
    cont.style.zIndex = 2000;
    document.body.appendChild(cont);
  }

  const el = document.createElement("div");
  el.className = `toast align-items-center text-bg-${tipo} border-0`;
  el.setAttribute("role", tipo === "danger" ? "alert" : "status");
  el.innerHTML = `
    <div class="d-flex">
      <div class="toast-body"></div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Cerrar"></button>
    </div>`;
  el.querySelector(".toast-body").textContent = mensaje;
  cont.appendChild(el);

  el.addEventListener("hidden.bs.toast", () => el.remove());
  new bootstrap.Toast(el, { delay: tipo === "danger" ? 6000 : 3500 }).show();
}

window.alert = (mensaje) => {
  const texto = String(mensaje ?? "");
  mostrarToast(texto, MENSAJES_OK.test(texto) ? "success" : "danger");
};

// ---------- ventana de diálogo (reemplaza a prompt y confirm) ----------

// Devuelve los datos del formulario al aceptar, o null si se cancela.
// Opciones extra: tamano ("lg"), alAbrir(el), recoger(form), validar(datos) → texto de error, sinConfirmar.
function dialogo({ titulo, cuerpo, confirmar = "Aceptar", tipoBoton = "success", tamano = "", alAbrir, recoger, validar, sinConfirmar = false }) {
  return new Promise((resolve) => {
    const el = document.createElement("div");
    el.className = "modal fade";
    el.tabIndex = -1;
    el.innerHTML = `
      <div class="modal-dialog modal-dialog-centered ${tamano ? "modal-" + tamano : ""}">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">${esc(titulo)}</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
          </div>
          <form>
            <div class="modal-body">
              <div class="alert alert-danger d-none" data-dlg-error></div>
              ${cuerpo}
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">${sinConfirmar ? "Cerrar" : "Cancelar"}</button>
              ${sinConfirmar ? "" : `<button type="submit" class="btn btn-${tipoBoton}">${esc(confirmar)}</button>`}
            </div>
          </form>
        </div>
      </div>`;
    document.body.appendChild(el);

    const modal = new bootstrap.Modal(el);
    let resultado = null;

    el.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const datos = recoger ? recoger(e.target) : Object.fromEntries(new FormData(e.target));
      const error = validar ? validar(datos) : null;
      if (error) {
        const caja = el.querySelector("[data-dlg-error]");
        caja.textContent = error;
        caja.classList.remove("d-none");
        return;
      }
      resultado = datos;
      modal.hide();
    });

    el.addEventListener("shown.bs.modal", () => {
      // por encima de otras ventanas que estén abiertas (por ejemplo el detalle del torneo)
      el.style.zIndex = 1065;
      [...document.querySelectorAll(".modal-backdrop")].pop()?.style.setProperty("z-index", "1060");
      el.querySelector("input, select, textarea")?.focus();
    });

    el.addEventListener("hidden.bs.modal", () => {
      modal.dispose();
      el.remove();
      resolve(resultado);
    });

    if (alAbrir) alAbrir(el);
    modal.show();
  });
}

async function confirmarAccion(titulo, mensaje, confirmar = "Aceptar", tipoBoton = "success") {
  const r = await dialogo({ titulo, cuerpo: `<p class="mb-0">${esc(mensaje)}</p>`, confirmar, tipoBoton });
  return r !== null;
}

// ---------- inscribir un equipo en un torneo ----------

async function inscribir(torneoId) {
  if (!exigirSesion()) return;
  try {
    const r = await api("/api/teams/equipos");
    const equipos = r.equipos || [];
    if (equipos.length === 0) {
      alert("Primero crea un equipo en la sección Equipos.");
      bootstrap.Modal.getInstance(document.getElementById("modalDetalle"))?.hide();
      location.hash = "#equipos";
      return;
    }

    const opciones = equipos
      .map((e) => `<option value="${esc(e.id)}">${esc(e.nombre)}${e.municipio ? " · " + esc(e.municipio) : ""}</option>`)
      .join("");

    const datos = await dialogo({
      titulo: "Solicitar inscripción",
      cuerpo: `
        <label class="form-label" for="dlgEquipo">¿Con qué equipo quieres solicitar entrada al torneo?</label>
        <select class="form-select" id="dlgEquipo" name="equipoId" required>
          ${equipos.length > 1 ? '<option value="" selected disabled>Selecciona un equipo</option>' : ""}
          ${opciones}
        </select>`,
      confirmar: "Enviar solicitud",
    });
    if (!datos) return;

    const equipo = equipos.find((e) => String(e.id) === datos.equipoId);
    if (!equipo) return;

    const ins = await api(`/api/matches/torneos/${torneoId}/inscripciones`, {
      method: "POST",
      body: JSON.stringify({ equipoId: equipo.id }),
    });
    bootstrap.Modal.getInstance(document.getElementById("modalDetalle"))?.hide();
    alert(`Solicitud enviada para ${equipo.nombre}. Estado: ${ins.inscripcion.estado}`);
    location.hash = "#inscripciones";
  } catch (e) {
    alert(e.message);
  }
}

// ---------- rechazar inscripción y generar grupos (sin tocar app.js) ----------
// Se interceptan los clics de esos botones antes de que lleguen al código viejo.

async function rechazarInscripcionConDialogo(btn) {
  const id = btn.dataset.rechazarInscripcion;
  const datos = await dialogo({
    titulo: "Rechazar inscripción",
    cuerpo: `
      <label class="form-label" for="dlgMotivo">Motivo del rechazo</label>
      <textarea class="form-control" id="dlgMotivo" name="motivo" rows="3" required>No cumple requisitos</textarea>`,
    confirmar: "Rechazar",
    tipoBoton: "danger",
  });
  const motivo = datos?.motivo?.trim();
  if (!motivo) return;

  try {
    await api(`/api/matches/inscripciones/${id}/rechazar`, {
      method: "POST",
      body: JSON.stringify({ motivo }),
    });
    alert("Inscripción rechazada.");
    if (btn.closest("#modalDetalle")) {
      const torneoId = document.getElementById("detalleTitulo").dataset.torneoId;
      if (torneoId) await abrirDetalleTorneoAdmin(torneoId);
    } else {
      cargarInscripciones();
    }
  } catch (e) {
    alert(e.message);
  }
}

async function generarGruposConDialogo(btn) {
  const id = btn.dataset.generarGrupos;
  const datos = await dialogo({
    titulo: "Generar grupos",
    cuerpo: `
      <label class="form-label" for="dlgCantidad">Número de grupos (de 2 a 16)</label>
      <input type="number" class="form-control" id="dlgCantidad" name="cantidad" min="2" max="16" value="2" required>`,
    confirmar: "Generar grupos",
  });
  if (!datos) return;

  try {
    await api(`/api/matches/torneos/${id}/grupos/generar`, {
      method: "POST",
      body: JSON.stringify({ cantidad: Number(datos.cantidad) }),
    });
    alert("Grupos generados.");
    abrirDetalleTorneoAdmin(id);
  } catch (e) {
    alert(e.message);
  }
}

document.addEventListener(
  "click",
  (e) => {
    const rechazar = e.target.closest("[data-rechazar-inscripcion]");
    if (rechazar) {
      e.preventDefault();
      e.stopPropagation();
      rechazarInscripcionConDialogo(rechazar);
      return;
    }
    const grupos = e.target.closest("[data-generar-grupos]");
    if (grupos) {
      e.preventDefault();
      e.stopPropagation();
      generarGruposConDialogo(grupos);
    }
  },
  true,
);

// ---------- jugador en conflicto: corregir documento y retirar ----------

async function corregirJugadorEnConflicto() {
  if (!jugadorConflictoActual) return;
  const { jugadorId, equipoId } = jugadorConflictoActual;
  try {
    const r = await api(`/api/teams/equipos/${equipoId}/jugadores`);
    const jugador = (r.jugadores || []).find((j) => j.id === jugadorId);
    if (!jugador) throw new Error("No se encontró el jugador.");

    const tipos = ["CC", "TI", "RC", "CE", "PPT", "PEP", "PA"];
    const tipoActual = jugador.tipoDocumento || "CC";

    const datos = await dialogo({
      titulo: "Corregir documento",
      cuerpo: `
        <p class="mb-3">
          <strong>${esc(jugador.nombres)} ${esc(jugador.apellidos)}</strong><br>
          <small class="text-muted">Documento actual: ${esc(jugador.documentoEnmascarado || "-")}</small>
        </p>
        <div class="row g-3">
          <div class="col-4">
            <label class="form-label" for="dlgTipoDoc">Tipo</label>
            <select class="form-select" id="dlgTipoDoc" name="tipoDocumento">
              ${tipos.map((t) => `<option value="${t}" ${t === tipoActual ? "selected" : ""}>${t}</option>`).join("")}
            </select>
          </div>
          <div class="col-8">
            <label class="form-label" for="dlgDocumento">Documento correcto</label>
            <input type="text" class="form-control" id="dlgDocumento" name="documento" value="${esc(jugador.documento || "")}" required>
          </div>
        </div>`,
      confirmar: "Guardar corrección",
    });
    if (!datos) return;

    await api(`/api/teams/jugadores/${jugadorId}`, {
      method: "PATCH",
      body: JSON.stringify({
        tipoDocumento: datos.tipoDocumento,
        documento: datos.documento.trim(),
        autorizacionAcudiente: true,
      }),
    });
    bootstrap.Modal.getInstance(document.getElementById("modalJugadorConflicto"))?.hide();
    alert("Jugador corregido. La plantilla del torneo se recalculará al refrescar.");
    const torneoId = document.getElementById("detalleTitulo").dataset.torneoId;
    if (torneoId) await abrirDetalleTorneoAdmin(torneoId);
  } catch (e) {
    alert(e.message);
  }
}

async function retirarJugadorEnConflicto() {
  if (!jugadorConflictoActual) return;
  const ok = await confirmarAccion(
    "Retirar jugador",
    "¿Quieres retirar este jugador del equipo para resolver el conflicto?",
    "Retirar",
    "danger",
  );
  if (!ok) return;

  try {
    await api(`/api/teams/jugadores/${jugadorConflictoActual.jugadorId}/anonimizar`, { method: "POST" });
    bootstrap.Modal.getInstance(document.getElementById("modalJugadorConflicto"))?.hide();
    alert("Jugador retirado.");
    const torneoId = document.getElementById("detalleTitulo").dataset.torneoId;
    if (torneoId) await abrirDetalleTorneoAdmin(torneoId);
  } catch (e) {
    alert(e.message);
  }
}