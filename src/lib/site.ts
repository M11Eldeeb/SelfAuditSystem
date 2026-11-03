// Desktop sidebar state (nav-bar.tsx): <html data-sidebar="closed"> hides it. Set before first paint by the root layout.
export const SIDEBAR_KEY = "sidebar";
export const SIDEBAR_INIT_SCRIPT = `(function(){try{if(localStorage.getItem("${SIDEBAR_KEY}")==="closed"){document.documentElement.dataset.sidebar="closed"}}catch(_){}})()`;
export const SITE_NAME = "MG Warranty Management";

/** AMS (SAIC Portal) is SMIL's site. It sends X-Frame-Options: SAMEORIGIN, so it cannot be shown inside a page here - the menu opens it in a new tab. */
export const AMS_LINK = { href: "https://portal.smil.com", label: "AMS (SAIC Portal)", external: true } as const;
