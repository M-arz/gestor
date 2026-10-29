const API = "http://localhost:8080";

const form = document.getElementById("forgotForm");
const errorBox = document.getElementById("forgotError");
const exitoBox = document.getElementById("forgotExito");
const button = document.getElementById("forgotButton");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.classList.add("d-none");
  exitoBox.classList.add("d-none");
  button.disabled = true;
  button.textContent = "Enviando...";

  try {
    const response = await fetch(`${API}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: document.getElementById("correo").value.trim() }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(data?.error?.message || data?.message || "No se pudo solicitar la recuperación.");
    }

    exitoBox.textContent = data?.mensaje || "Si la cuenta existe, enviaremos un enlace al correo.";
    exitoBox.classList.remove("d-none");
    form.classList.add("d-none");
  } catch (error) {
    errorBox.textContent = error.message || "No se pudo conectar con el servidor.";
    errorBox.classList.remove("d-none");
  } finally {
    button.disabled = false;
    button.textContent = "Enviar enlace";
  }
});