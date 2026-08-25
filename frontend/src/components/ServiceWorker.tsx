"use client";

import { useEffect } from "react";

/**
 * Registers the service worker, once, after the page has settled.
 *
 * Registration waits for `load` so it never competes with the first paint for
 * bandwidth — the worker's whole job is the SECOND visit, so nothing is gained
 * by racing the first one.
 *
 * DEVELOPMENT IS EXCLUDED DELIBERATELY. A worker that serves cached navigations
 * in front of the dev server produces the worst debugging experience there is:
 * edits appear not to apply, and the cause is invisible. It registers only in a
 * production build.
 *
 * Failure is swallowed on purpose. The app works without a worker — it loses
 * offline start-up and nothing else — so a registration error is not worth an
 * error surface in front of the user.
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* offline start-up is unavailable; everything else still works */
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
