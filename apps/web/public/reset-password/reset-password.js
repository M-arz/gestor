const API = "http://localhost:8080";

const params = new URLSearchParams(window.location.search);
const token = params.get("token");

const form = document.getElementById("resetForm");
const errorBox = document.getElementById("resetError");
const exitoBox = document.getElementById("resetExito");
const button = document.getElementById("resetButton");

if (!token) {
  errorBox.textContent = "El enlace no es válido o le falta el token.";
  errorBox.classList.remove("d-none");
  form.classList.add("d-none");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.classList.add("d-none");
  exitoBox.classList.add("d-none");

  const c1 = document.getElementById("contrasena").value;
  const c2 = document.getElementById("contrasena2").value;
  if (c1 !== c2) {
    errorBox.textContent = "Las contraseñas no coinciden.";
    errorBox.classList.remove("d-none");
    return;
  }

  button.disabled = true;
  button.textContent = "Cambiando...";

  try {
    const response = await fetch(`${API}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, contrasena: c1 }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(data?.error?.message || data?.message || "No se pudo restablecer la contraseña.");
    }

    exitoBox.textContent = "Tu contraseña se actualizó correctamente. Ya puedes iniciar sesión.";
    exitoBox.classList.remove("d-none");
    form.classList.add("d-none");
  } catch (error) {
    errorBox.textContent = error.message || "No se pudo conectar con el servidor.";
    errorBox.classList.remove("d-none");
  } finally {
    button.disabled = false;
    button.textContent = "Cambiar contraseña";
  }
});