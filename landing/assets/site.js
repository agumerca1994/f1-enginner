// Shared behaviour for the landing pages.
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Nav background once the page scrolls.
const nav = document.getElementById("nav");
const onScroll = () => nav.classList.toggle("scrolled", scrollY > 24);
addEventListener("scroll", onScroll, { passive: true });
onScroll();

// Reveal on scroll; the radio log plays its messages one by one.
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add("in");
    e.target.querySelectorAll(".log .item").forEach((it, i) =>
      setTimeout(() => it.classList.add("show"), reduce ? 0 : 300 + i * 650));
    io.unobserve(e.target);
  }
}, { threshold: .15 });
document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

const stage = document.getElementById("stage");
if (stage) requestAnimationFrame(() => stage.classList.add("in"));

// Hero radio: types each call, holds it, then moves to the next.
const msg = document.getElementById("hero-msg");
if (msg) {
  const calls = [
    ["Estrategia · V1", "", "Plan A: una parada. Medios hasta la 12 y duros hasta el final."],
    ["Ritmo · V6", "", "Le sacás tres décimas al de adelante en el sector 3. Lo tenés en dos vueltas."],
    ["Clima · V9", "warn", "Lluvia en diez minutos en el sector 2. Quedate afuera, yo te aviso."],
    ["Box · V12", "", "Box, box. Duros. Salís sexto y con aire limpio."],
  ];
  const tag = document.getElementById("hero-tag");
  let n = 1;
  const play = () => {
    const [t, kind, text] = calls[n++ % calls.length];
    tag.textContent = t;
    tag.className = "label tag" + (kind ? " " + kind : "");
    if (reduce) { msg.textContent = text; return setTimeout(play, 5000); }
    let i = 0;
    (function type() {
      msg.innerHTML = text.slice(0, i) + '<span class="caret"></span>';
      if (i++ < text.length) return setTimeout(type, 26);
      setTimeout(play, 3600);
    })();
  };
  setTimeout(play, 4200);
}

// Guide tabs; the URL hash (#consola, #pc, #claude, #chatgpt) picks one.
const tabs = [...document.querySelectorAll(".tab")];
const select = (tab) => tabs.forEach((o) => {
  const on = o === tab;
  o.setAttribute("aria-selected", on);
  const panel = document.getElementById(o.getAttribute("aria-controls"));
  panel.hidden = !on;
  panel.classList.toggle("on", on);
});
tabs.forEach((t) => t.addEventListener("click", () => {
  select(t);
  history.replaceState(null, "", "#" + t.id.slice(2));
}));
const fromHash = () => {
  const t = document.getElementById("t-" + location.hash.slice(1));
  if (t && tabs.includes(t)) select(t);
};
addEventListener("hashchange", fromHash);
fromHash();

// Copy the connector URL.
document.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Copiada"; }
  catch { b.textContent = "Seleccioná y copiá"; }
  setTimeout(() => (b.textContent = "Copiar"), 1600);
}));
