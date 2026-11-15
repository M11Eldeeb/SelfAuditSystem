/**
 * Runs before first paint: the welcome intro plays once per browser session and never with Reduce Motion - otherwise
 * <html> gets "no-welcome" and the intro sheet is never shown.
 */
export const WELCOME_INIT_SCRIPT = `(function(){var d=document.documentElement;try{if(sessionStorage.getItem("mgw-welcome")||window.matchMedia("(prefers-reduced-motion: reduce)").matches){d.classList.add("no-welcome")}else{sessionStorage.setItem("mgw-welcome","1")}}catch(_){d.classList.add("no-welcome")}})()`;
