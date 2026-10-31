const API = "http://localhost:8080";

const form = document.getElementById("registroForm");
const errorBox = document.getElementById("registroError");
const successBox = document.getElementById("registroExito");
const button = document.getElementById("registroButton");
const buttonText = button.querySelector("span");
const tipoCuentaInput = document.getElementById("tipoCuenta");
const contenedorCodigo = document.getElementById("contenedorCodigo");
const codigoAccesoInput = document.getElementById("codigoAcceso");
const passwordInput = document.getElementById("contrasena");

function mostrarCodigoAdmin() {
  const esAdmin = tipoCuentaInput.value === "admin";
  contenedorCodigo.classList.toggle("d-none", !esAdmin);
  if (!esAdmin) {
    codigoAccesoInput.value = "";
  }
}

tipoCuentaInput.addEventListener("change", mostrarCodigoAdmin);

function limpiarMensajes() {
  errorBox.classList.add("d-none");
  errorBox.textContent = "";
  successBox.classList.add("d-none");
  successBox.textContent = "";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  limpiarMensajes();

  const nombre = document.getElementById("nombre").value.trim();
  const correo = document.getElementById("correo").value.trim();
  const contrasena = passwordInput.value;
  const aceptaPolitica = document.getElementById("aceptaPolitica").checked;
  const tipoCuenta = tipoCuentaInput.value;
  const codigo = codigoAccesoInput.value.trim();

  if (!nombre || !correo || !contrasena || !aceptaPolitica) {
    errorBox.textContent = "Completa todos los campos obligatorios.";
    errorBox.classList.remove("d-none");
    return;
  }

  if (contrasena.length < 10) {
    errorBox.textContent = "La contraseña debe tener al menos 10 caracteres.";
    errorBox.classList.remove("d-none");
    return;
  }

  if (tipoCuenta === "admin" && !codigo) {
    errorBox.textContent = "Introduce el código de acceso de administrador.";
    errorBox.classList.remove("d-none");
    return;
  }

  button.disabled = true;
  buttonText.textContent = "Creando cuenta...";

  try {
    const endpoint = tipoCuenta === "admin" ? "/api/auth/register-admin" : "/api/auth/register";
    const payload = {
      nombre,
      correo,
      contrasena,
      aceptaPolitica,
      ...(tipoCuenta === "admin" ? { codigo } : {}),
    };

    const response = await fetch(`${API}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
        data?.message ||
        "No se pudo crear la cuenta."
      );
    }

    successBox.textContent = "Cuenta creada correctamente. Redirigiendo al inicio de sesión...";
    successBox.classList.remove("d-none");

    setTimeout(() => {
      window.location.href = "../login/";
    }, 1200);
  } catch (error) {
    errorBox.textContent = error.message || "No se pudo conectar con el servidor.";
    errorBox.classList.remove("d-none");
  } finally {
    button.disabled = false;
    buttonText.textContent = "Crear cuenta";
  }
});

mostrarCodigoAdmin();
