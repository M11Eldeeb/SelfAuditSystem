import Image from "next/image";

/**
 * Opening the portal: "Welcome to / MG Warranty" - the badge settles in, the name is drawn stroke by stroke and then
 * filled, a short red line underlines it, and the whole sheet fades away (about 2.8 s). Pure CSS, so it plays before
 * any script has loaded. Shown once per browser session; never with Reduce Motion (WELCOME_INIT_SCRIPT decides).
 */
export const WELCOME_INIT_SCRIPT = `(function(){var d=document.documentElement;try{if(sessionStorage.getItem("mgw-welcome")||window.matchMedia("(prefers-reduced-motion: reduce)").matches){d.classList.add("no-welcome")}else{sessionStorage.setItem("mgw-welcome","1")}}catch(_){d.classList.add("no-welcome")}})()`;

export function WelcomeIntro() {
  return (
    <div className="welcome-intro" aria-hidden="true">
      <div className="welcome-intro__stack">
        <Image src="/mg-logo.png" alt="" width={1037} height={1024} priority className="welcome-intro__logo" />
        <p className="welcome-intro__kicker">Welcome to</p>
        <svg className="welcome-intro__word" viewBox="0 0 720 110" role="presentation">
          <text x="360" y="84" textAnchor="middle">
            MG Warranty
          </text>
        </svg>
        <span className="welcome-intro__rule" />
      </div>
    </div>
  );
}
