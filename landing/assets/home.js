// The landing's page behaviour: nav background, reveals, the radio log and the hero radio.
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

const nav = document.getElementById("nav");
const onScroll = () => nav.classList.toggle("scrolled", scrollY > 24);
addEventListener("scroll", onScroll, { passive: true });
onScroll();

const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add("in");
    e.target.querySelectorAll(".item").forEach((it, i) => setTimeout(() => it.classList.add("show"), reduce ? 0 : 250 + i * 700));
    io.unobserve(e.target);
  }
}, { threshold: 0.15 });
document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

// Without the intro (seen already, or reduced motion) the hero animates in at once.
if (document.documentElement.classList.contains("no-intro")) document.documentElement.classList.add("intro-done");

// Hero radio: types each call, holds it, then the next.
const msg = document.getElementById("hero-msg");
const tag = document.getElementById("hero-tag");
if (msg && tag) {
  const calls = [
    ["Radio · V4", "Gasly a tres décimas. Defendé por dentro en la 12."],
    ["Radio · V5", "Lluvia en diez minutos. Quedate afuera, yo te aviso."],
    ["Boxes", "Probá barra delantera de 15 a 13: no gira en las lentas."],
    ["Radio · V9", "Box, box. Intermedios. Salís sexto con aire limpio."],
  ];
  let n = 1;
  const play = () => {
    const [t, text] = calls[n++ % calls.length];
    tag.textContent = t;
    if (reduce) { msg.textContent = text; return setTimeout(play, 5000); }
    let i = 0;
    (function type() {
      msg.innerHTML = text.slice(0, i) + '<span class="caret"></span>';
      if (i++ < text.length) return setTimeout(type, 24);
      setTimeout(play, 3400);
    })();
  };
  setTimeout(play, 4600);
}
