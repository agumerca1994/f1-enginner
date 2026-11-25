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
  video.poster = `/assets/intro/poster-${portrait ? "v" : "h"}.jpg?v=6`;
  video.src = `/assets/intro/intro-${portrait ? "v" : "h"}.mp4?v=6`; // H.264: what every phone plays
  const flash = intro.querySelector(".intro-flash");
  const title = intro.querySelector(".intro-title");
  // A browser that will not autoplay (or a slow network) gets the page straight away.
  const giveUp = setTimeout(() => endIntro(true), 3500);
  video.addEventListener("playing", () => { clearTimeout(giveUp); intro.classList.add("playing"); }, { once: true });
  video.addEventListener("timeupdate", () => {
    if (video.currentTime > video.duration - 0.45 && !title.classList.contains("on")) { flash.classList.add("on"); title.classList.add("on"); }
  });
  video.addEventListener("ended", () => setTimeout(() => endIntro(false), 500));
  video.addEventListener("error", () => endIntro(true));
  // With sound by default. Browsers only allow it after the visitor has touched the page, so when
  // they refuse it starts muted and the first tap on the intro turns the sound on.
  const sound = intro.querySelector(".intro-sound");
  const label = sound.querySelector("span");
  const setSound = (on) => {
    video.muted = !on;
    sound.setAttribute("aria-pressed", String(on));
    label.textContent = on ? "Silenciar" : "Activar sonido";
  };
  let blocked = false; // muted by the browser, not by the visitor
  setSound(true);
  video.play().catch(() => {
    blocked = true;
    setSound(false);
    return video.play();
  }).catch(() => endIntro(true));
  sound.addEventListener("click", () => { blocked = false; setSound(video.muted); });
  intro.querySelector(".intro-skip")?.addEventListener("click", () => endIntro(true));
  intro.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".intro-skip, .intro-sound")) return;
    if (blocked) { blocked = false; setSound(true); } // the first tap brings the sound; the next one skips
    else endIntro(true);
  });
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
