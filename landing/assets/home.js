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

// --- the intro: a rendered video of cars passing a corner, then the page slides in --------------
const html = document.documentElement;
const intro = document.getElementById("intro");
let introOver = false;
function endIntro(fast) {
  if (introOver || !intro) return;
  introOver = true;
  try { sessionStorage.setItem("intro-visto", "1"); } catch (e) {}
  html.classList.add("intro-done");
  intro.classList.add(fast ? "out-fast" : "out");
  setTimeout(() => { intro.remove(); html.classList.remove("intro-on"); }, fast ? 250 : 900);
}
if (!intro || html.classList.contains("no-intro")) {
  html.classList.add("intro-done");
} else {
  const video = intro.querySelector("video");
  const portrait = innerHeight > innerWidth;
  video.poster = `/assets/intro/poster-${portrait ? "v" : "h"}.jpg?v=4`;
  video.src = `/assets/intro/intro-${portrait ? "v" : "h"}.mp4?v=4`; // H.264: what every phone plays
  const flash = intro.querySelector(".intro-flash");
  const title = intro.querySelector(".intro-title");
  // A browser that will not autoplay (or a slow network) gets the page straight away.
  const giveUp = setTimeout(() => endIntro(true), 3500);
  video.addEventListener("playing", () => { clearTimeout(giveUp); intro.classList.add("playing"); }, { once: true });
  video.addEventListener("timeupdate", () => {
    if (video.currentTime > video.duration - 0.8 && !title.classList.contains("on")) { flash.classList.add("on"); title.classList.add("on"); }
  });
  video.addEventListener("ended", () => setTimeout(() => endIntro(false), 500));
  video.addEventListener("error", () => endIntro(true));
  video.play().catch(() => endIntro(true));
  intro.querySelector(".intro-skip")?.addEventListener("click", () => endIntro(true));
  intro.addEventListener("pointerdown", (e) => { if (!e.target.closest(".intro-skip")) endIntro(true); });
  addEventListener("keydown", () => endIntro(true), { once: true });
}

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
