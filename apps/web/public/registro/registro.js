
const API = "http://localhost:8080";

const formulario = document.getElementById("registroForm");
const errorElemento = document.getElementById("registroError");
const exitoElemento = document.getElementById("registroExito");
const boton = document.getElementById("registroButton");

let solicitudId = null;
let procesando = false;

// Crear el selector de tipo de cuenta si no existe.
let selectorTipo = document.getElementById("tipoCuenta");

if (!selectorTipo) {
  const contenedor = document.createElement("div");
  contenedor.className = "mb-3";
  contenedor.innerHTML = `
    <label for="tipoCuenta" class="form-label">Tipo de cuenta</label>
    <select id="tipoCuenta" class="form-select" required>
      <option value="delegado">Delegado</option>
      <option value="admin">Administrador</option>
    </select>
  `;

  formulario.prepend(contenedor);
  selectorTipo = document.getElementById("tipoCuenta");
}

// Crear el campo del código de administrador si no existe.
let contenedorCodigo = document.getElementById("contenedorCodigo");
let campoCodigo = document.getElementById("codigoAcceso");

if (!contenedorCodigo || !campoCodigo) {
  contenedorCodigo = document.createElement("div");
  contenedorCodigo.id = "contenedorCodigo";
  contenedorCodigo.className = "mb-3 d-none";
  contenedorCodigo.innerHTML = `
    <label for="codigoAcceso" class="form-label">
      Código de acceso de administrador
    </label>
    <input
      type="text"
      id="codigoAcceso"
      class="form-control"
      placeholder="Introduce tu código"
      autocomplete="off"
    >
    <small class="form-text text-muted">
      Introduce el código que te proporcionó el administrador.
    </small>
  `;

  boton.before(contenedorCodigo);
  campoCodigo = document.getElementById("codigoAcceso");
}

function mostrarError(mensaje) {
  errorElemento.textContent = mensaje;
  errorElemento.classList.remove("d-none");
}

function limpiarMensajes() {
  errorElemento.classList.add("d-none");
  exitoElemento.classList.add("d-none");
}

function actualizarBoton() {
  if (procesando) return;

  if (selectorTipo.value === "admin" && solicitudId) {
    boton.textContent = "INICIAR SESIÓN";
    boton.disabled = campoCodigo.value.trim().length === 0;
  } else {
    boton.textContent =
      selectorTipo.value === "admin"
        ? "ENVIAR SOLICITUD"
        : "Crear cuenta";

    boton.disabled = false;
  }
}

function mostrarExito(mensaje) {
  formulario.classList.add("d-none");
  exitoElemento.textContent = mensaje;
  exitoElemento.classList.remove("d-none");

  const enlaceExistente = document.getElementById("enlaceLogin");

  if (!enlaceExistente) {
    const enlace = document.createElement("a");
    enlace.id = "enlaceLogin";
    enlace.href = "../login/";
    enlace.className = "btn btn-primary w-100 mt-3";
    enlace.textContent = "Ir a iniciar sesión";

    exitoElemento.insertAdjacentElement("afterend", enlace);
  }
}

async function enviarSolicitudAdmin(datos) {
  const respuesta = await fetch(
    `${API}/api/auth/register-admin/request`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(datos)
    }
  );

  const resultado = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok) {
    throw new Error(
      resultado?.error?.message ||
      resultado?.message ||
      `No se pudo enviar la solicitud (error ${respuesta.status}).`
    );
  }

  if (!resultado.solicitudId) {
    throw new Error("El servidor no devolvió el identificador de la solicitud.");
  }

  solicitudId = resultado.solicitudId;

  // Bloquear los datos originales y mostrar el campo del código.
  for (const id of ["nombre", "correo", "contrasena", "aceptaPolitica"]) {
    const campo = document.getElementById(id);
    if (campo) campo.disabled = true;
  }

  selectorTipo.disabled = true;
  contenedorCodigo.classList.remove("d-none");
  campoCodigo.required = true;
  campoCodigo.focus();

  exitoElemento.textContent =
    resultado.mensaje ||
    "Solicitud guardada. Introduce tu código de acceso para continuar.";

  exitoElemento.classList.remove("d-none");
}

async function completarRegistroAdmin() {
  const respuesta = await fetch(
    `${API}/api/auth/register-admin/complete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        solicitudId,
        codigo: campoCodigo.value.trim()
      })
    }
  );

  const resultado = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok) {
    throw new Error(
      resultado?.error?.message ||
      resultado?.message ||
      `No se pudo validar el código (error ${respuesta.status}).`
    );
  }

  mostrarExito("¡Tu cuenta de administrador se creó correctamente! Ya puedes iniciar sesión.");
}

formulario.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (procesando) return;

  limpiarMensajes();

  const datos = {
    nombre: document.getElementById("nombre").value.trim(),
    correo: document.getElementById("correo").value.trim(),
    contrasena: document.getElementById("contrasena").value,
    aceptaPolitica: document.getElementById("aceptaPolitica").checked
  };

  procesando = true;
  boton.disabled = true;

  try {
    if (selectorTipo.value === "admin") {
      if (solicitudId) {
        boton.textContent = "Validando código...";
        await completarRegistroAdmin();
      } else {
        boton.textContent = "Enviando solicitud...";
        await enviarSolicitudAdmin(datos);
      }
    } else {
      boton.textContent = "Creando cuenta...";

      const respuesta = await fetch(`${API}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(datos)
      });

      const resultado = await respuesta.json().catch(() => ({}));

      if (!respuesta.ok) {
        throw new Error(
          resultado?.error?.message ||
          resultado?.message ||
          `No se pudo crear la cuenta (error ${respuesta.status}).`
        );
      }

      mostrarExito("¡Tu cuenta se creó correctamente! Ya puedes iniciar sesión.");
    }
  } catch (error) {
    mostrarError(error.message || "No se pudo conectar con el servidor.");
  } finally {
    procesando = false;

    if (!formulario.classList.contains("d-none")) {
      actualizarBoton();
    }
  }
});

selectorTipo.addEventListener("change", () => {
  limpiarMensajes();

  // No permitir cambiar de tipo una vez creada una solicitud.
  if (solicitudId) return;

  contenedorCodigo.classList.add("d-none");
  campoCodigo.required = false;
  campoCodigo.value = "";

  actualizarBoton();
});

campoCodigo.addEventListener("input", actualizarBoton);

actualizarBoton();
