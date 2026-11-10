(() => {
  const INTERVALO = 5000; // milisegundos entre imágenes

  const carrusel = document.getElementById("loginCarousel");
  if (!carrusel) return;

  const slides = Array.from(carrusel.querySelectorAll(".carousel-slide"));
  const contenedorDots = carrusel.querySelector(".carousel-dots");
  if (slides.length === 0) return;

  let actual = 0;
  let temporizador = null;

  // Crear un punto por cada imagen
  const dots = slides.map((_, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "carousel-dot";
    dot.setAttribute("role", "tab");
    dot.setAttribute("aria-label", `Ir a la imagen ${i + 1}`);
    dot.addEventListener("click", () => {
      mostrar(i);
      reiniciar();
    });
    contenedorDots.appendChild(dot);
    return dot;
  });

  function mostrar(indice) {
    actual = (indice + slides.length) % slides.length;
    slides.forEach((s, i) => s.classList.toggle("active", i === actual));
    dots.forEach((d, i) => {
      d.classList.toggle("active", i === actual);
      d.setAttribute("aria-selected", String(i === actual));
    });
  }

  function iniciar() {
    if (slides.length < 2) return;
    detener();
    temporizador = setInterval(() => mostrar(actual + 1), INTERVALO);
  }

  function detener() {
    clearInterval(temporizador);
    temporizador = null;
  }

  function reiniciar() {
    iniciar();
  }

  mostrar(0);

  // Respeta a quien pide menos animaciones
  const reducir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reducir) iniciar();

  // Pausa al pasar el mouse y cuando la pestaña no está visible
  carrusel.addEventListener("mouseenter", detener);
  carrusel.addEventListener("mouseleave", () => !reducir && iniciar());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) detener();
    else if (!reducir) iniciar();
  });
})();