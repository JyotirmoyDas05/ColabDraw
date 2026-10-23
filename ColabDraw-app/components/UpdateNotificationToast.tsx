import { CloseIcon } from "@excalidraw/excalidraw/components/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { registerSW } from "virtual:pwa-register";

import { LocalData } from "../data/LocalData";

import "./UpdateNotificationToast.scss";

// Refresh icon (SVG circular arrows)
const RefreshIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 11a8.1 8.1 0 0 0-15.5-2m-.5-4v5h5" />
    <path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-5h-5" />
  </svg>
);

// Minimum interval between update checks (in ms) to avoid spamming network
const MIN_CHECK_INTERVAL_MS = 25000;
// Periodic background check interval (60 seconds)
const PERIODIC_CHECK_INTERVAL_MS = 60000;

export const UpdateNotificationToast = () => {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateFunction, setUpdateFunction] = useState<
    (() => Promise<void>) | null
  >(null);

  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const lastCheckTimeRef = useRef<number>(0);
  const isCheckingRef = useRef<boolean>(false);
  const isDismissedRef = useRef<boolean>(false);

  // Function to check both Service Worker and /version.json for newer build
  const checkForUpdate = useCallback(async () => {
    // Skip in development mode or if user has already dismissed this update
    if (import.meta.env.DEV || isDismissedRef.current) {
      return;
    }

    const now = Date.now();
    if (
      now - lastCheckTimeRef.current < MIN_CHECK_INTERVAL_MS ||
      isCheckingRef.current
    ) {
      return;
    }

    lastCheckTimeRef.current = now;
    isCheckingRef.current = true;

    try {
      // 1. Trigger Service Worker update check if available
      if (registrationRef.current) {
        try {
          await registrationRef.current.update();
        } catch {
          // Ignore service worker update check errors (e.g. offline)
        }
      }

      // 2. Fetch /version.json with timestamp bust to bypass any caching
      const response = await fetch(`/version.json?_=${now}`, {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      });

      if (response.ok) {
        const data = (await response.json()) as {
          version?: string;
          gitSha?: string;
        };
        const currentClientSha = (
          import.meta.env.VITE_APP_GIT_SHA || ""
        ).trim();
        const serverSha = (data.gitSha || data.version || "").trim();

        // If client and server SHAs are valid non-default strings and differ
        if (
          currentClientSha &&
          serverSha &&
          currentClientSha !== "none" &&
          currentClientSha !== "development" &&
          !serverSha.startsWith(currentClientSha) &&
          !currentClientSha.startsWith(serverSha)
        ) {
          setNeedRefresh(true);
        }
      }
    } catch {
      // Network failure or offline, silently ignore
    } finally {
      isCheckingRef.current = false;
    }
  }, []);

  useEffect(() => {
    // 1. Register Service Worker if supported
    if ("serviceWorker" in navigator) {
      const updateSW = registerSW({
        onNeedRefresh() {
          if (!isDismissedRef.current) {
            setNeedRefresh(true);
          }
        },
        onOfflineReady() {
          // App is cached and ready for offline use
        },
        onRegistered(registration) {
          if (registration) {
            registrationRef.current = registration;
          }
        },
        onRegisteredSW(_swUrl, registration) {
          if (registration) {
            registrationRef.current = registration;
          }
        },
      });

      setUpdateFunction(() => updateSW);

      // Attempt to acquire active registration
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg) {
          registrationRef.current = reg;
        }
      });
    }

    // 2. Initial check after 4 seconds to let page finish initial loading
    const initialTimer = window.setTimeout(() => {
      checkForUpdate();
    }, 4000);

    // 3. Periodic timer check every 60 seconds
    const intervalTimer = window.setInterval(() => {
      checkForUpdate();
    }, PERIODIC_CHECK_INTERVAL_MS);

    // 4. Activity listeners: user movement, tab focus, visibility change
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkForUpdate();
      }
    };

    const onWindowFocus = () => {
      checkForUpdate();
    };

    const onUserActivity = () => {
      // Throttle user activity checks to MIN_CHECK_INTERVAL_MS
      if (Date.now() - lastCheckTimeRef.current >= MIN_CHECK_INTERVAL_MS) {
        checkForUpdate();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onWindowFocus);
    window.addEventListener("mousemove", onUserActivity, { passive: true });
    window.addEventListener("pointerdown", onUserActivity, { passive: true });
    window.addEventListener("keydown", onUserActivity, { passive: true });

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onWindowFocus);
      window.removeEventListener("mousemove", onUserActivity);
      window.removeEventListener("pointerdown", onUserActivity);
      window.removeEventListener("keydown", onUserActivity);
    };
  }, [checkForUpdate]);

  const handleReload = useCallback(async () => {
    try {
      // Flush pending local edits first so no canvas drawings are lost
      LocalData.flushSave();

      if (updateFunction) {
        await updateFunction();
      }
    } catch (e) {
      console.error("Failed to update service worker:", e);
    } finally {
      window.location.reload();
    }
  }, [updateFunction]);

  const handleDismiss = useCallback(() => {
    isDismissedRef.current = true;
    setNeedRefresh(false);
  }, []);

  if (!needRefresh) {
    return null;
  }

  return (
    <div className="update-available-toast" role="alert" aria-live="polite">
      <div className="update-available-toast__icon">
        <RefreshIcon />
      </div>
      <div className="update-available-toast__text">
        A new version of ColabDraw is available.
      </div>
      <div className="update-available-toast__actions">
        <button
          type="button"
          className="update-available-toast__reload-btn"
          onClick={handleReload}
        >
          Update
        </button>
        <button
          type="button"
          className="update-available-toast__close-btn"
          aria-label="Dismiss update notification"
          onClick={handleDismiss}
        >
          {CloseIcon}
        </button>
      </div>
    </div>
  );
};
