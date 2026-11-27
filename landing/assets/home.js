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

// --- the intro: the logo's start (lights, the cars round the P), then the logo flies to the nav ---
const html = document.documentElement;
const intro = document.getElementById("intro");
const video = intro && intro.querySelector("video");
let introOver = false;
// Where the logo's square sits in the video, in source pixels of a 1080-high frame (both cuts).
const SQ_CY = 464.4, SQ_SIZE = 799.2;
function flyToBrand() {
  const target = document.querySelector("#nav .brand img");
  const r = target && target.getBoundingClientRect();
  if (!r || !r.width || !video.videoWidth) return false;
  const W = video.clientWidth, H = video.clientHeight, vw = video.videoWidth, vh = video.videoHeight;
  const k = Math.min(W / vw, H / vh); // object-fit: contain
  const s = (SQ_SIZE / 1080) * vh * k;
  const left = (W - vw * k) / 2 + (vw / 2) * k - s / 2;
  const top = (H - vh * k) / 2 + (SQ_CY / 1080) * vh * k - s / 2;
  // keep only the square, then move it onto the nav's logo while the dark around it fades
  video.style.clipPath = `inset(${top}px ${W - left - s}px ${H - top - s}px ${left}px round ${s * 0.21875}px)`;
  intro.classList.add("out");
  void video.offsetWidth;
  const sc = r.width / s;
  video.style.transform = `translate(${r.left - left * sc}px, ${r.top - top * sc}px) scale(${sc})`;
  return true;
}
function endIntro(fast) {
  if (introOver || !intro) return;
  introOver = true;
  try { sessionStorage.setItem("intro-visto", "1"); } catch (e) {}
  html.classList.add("intro-done");
  const flew = !fast && flyToBrand();
  if (!flew) { video.pause(); intro.classList.add("out-fast"); }
  setTimeout(() => { intro.remove(); html.classList.remove("intro-on"); }, flew ? 800 : 250);
}
if (!intro || html.classList.contains("no-intro")) {
  html.classList.add("intro-done");
} else {
  const portrait = innerHeight > innerWidth;
  video.poster = `/assets/intro/poster-${portrait ? "v" : "h"}.jpg?v=7`;
  video.src = `/assets/intro/intro-${portrait ? "v" : "h"}.mp4?v=7`; // H.264 + AAC: what every phone plays
  // A browser that will not autoplay (or a slow network) gets the page straight away.
  const giveUp = setTimeout(() => endIntro(true), 3500);
  video.addEventListener("playing", () => { clearTimeout(giveUp); intro.classList.add("playing"); }, { once: true });
  video.addEventListener("ended", () => setTimeout(() => endIntro(false), 250));
  video.addEventListener("error", () => endIntro(true));
  // With sound by default. Browsers only allow it after the visitor has touched the page, so when
  // they refuse it starts muted and the first tap turns the sound on. The tap must be a click: on
  // phones a pointerdown is not a user gesture, so unmuting there was refused (or paused the video).
  const sound = intro.querySelector(".intro-sound");
  const label = sound.querySelector("span");
  const setSound = (on) => {
    video.muted = !on;
    sound.setAttribute("aria-pressed", String(on));
    label.textContent = on ? "Silenciar" : "Activar sonido";
    if (on && video.paused && !introOver) video.play().catch(() => {});
  };
  let blocked = false; // muted by the browser, not by the visitor
  setSound(true);
  video.play().catch(() => {
    blocked = true;
    setSound(false);
    return video.play();
  }).catch(() => endIntro(true));
  sound.addEventListener("click", (e) => { e.stopPropagation(); blocked = false; setSound(video.muted); });
  intro.querySelector(".intro-skip")?.addEventListener("click", (e) => { e.stopPropagation(); endIntro(true); });
  intro.addEventListener("click", () => {
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
