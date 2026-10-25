// Desktop sidebar state (nav-bar.tsx): <html data-sidebar="closed"> hides it. Set before first paint by the root layout.
export const SIDEBAR_KEY = "sidebar";
export const SIDEBAR_INIT_SCRIPT = `(function(){try{if(localStorage.getItem("${SIDEBAR_KEY}")==="closed"){document.documentElement.dataset.sidebar="closed"}}catch(_){}})()`;
export const SITE_NAME = "MG Warranty Management";
