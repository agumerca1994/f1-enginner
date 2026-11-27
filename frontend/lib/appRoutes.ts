// Screens that draw their own full-screen layout: overlays for OBS, linked screens,
// the cockpit, the replay player and the sign-in flow.
export const BARE = ["/overlay", "/oauth", "/volante", "/replay", "/pantalla", "/cockpit"];
// Linked screens and overlays watch with their own token, outside the signed-in app.
export const NO_LIVE = ["/overlay", "/oauth", "/pantalla"];

/** Routes that never get the start-up intro: the ones with their own full-screen layout. */
export const INTRO_SKIP = [...new Set([...BARE, ...NO_LIVE])];

export const INTRO_SEEN_KEY = "pel-intro-v1"; // the intro plays once per browser session

/** Runs before the first paint: when the intro is going to play, the page starts dark (html.intro-boot)
 *  so the loading screen never shows before it; the intro takes over the start-up loading. */
export const INTRO_BOOT = `(function(){try{var p=location.pathname;if(sessionStorage.getItem("${INTRO_SEEN_KEY}")==="1")return;if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;var s=${JSON.stringify(INTRO_SKIP)};for(var i=0;i<s.length;i++)if(p.indexOf(s[i])===0)return;document.documentElement.classList.add("intro-boot")}catch(e){}})()`;
