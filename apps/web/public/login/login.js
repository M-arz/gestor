
const API = "http://localhost:8080";

const form = document.getElementById("loginForm");
const errorBox = document.getElementById("loginError");
const button = document.getElementById("loginButton");
const buttonText = button.querySelector("span");
const passwordInput = document.getElementById("contrasena");
const passwordToggle = document.getElementById("togglePassword");

passwordToggle.addEventListener("click", () => {
  const mostrar = passwordInput.type === "password";

  passwordInput.type = mostrar ? "text" : "password";
  passwordToggle.setAttribute("aria-pressed", String(mostrar));
  passwordToggle.setAttribute(
    "aria-label",
    mostrar ? "Ocultar contraseña" : "Mostrar contraseña"
  );
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  errorBox.classList.add("d-none");
  errorBox.textContent = "";

  button.disabled = true;
  buttonText.textContent = "Verificando...";

  try {
    const response = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "include",
      body: JSON.stringify({
        correo: document.getElementById("correo").value.trim(),
        contrasena: passwordInput.value
      })
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
        data?.message ||
        "No se pudo iniciar sesión."
      );
    }

    if (!data?.accessToken || !data?.usuario) {
      throw new Error("El servidor no devolvió una sesión válida.");
    }

    localStorage.setItem("gestor_token", data.accessToken);
    localStorage.setItem(
      "gestor_usuario",
      JSON.stringify(data.usuario)
    );

    window.location.replace("/");
  } catch (error) {
    errorBox.textContent =
      error.message || "No se pudo conectar con el servidor.";

    errorBox.classList.remove("d-none");
  } finally {
    button.disabled = false;
    buttonText.textContent = "Iniciar sesión";
  }
});
