import { CloseIcon } from "@excalidraw/excalidraw/components/icons";
import { useCallback, useEffect, useState } from "react";
import { registerSW } from "virtual:pwa-register";

import { LocalData } from "../data/LocalData";
import "./UpdateNotificationToast.scss";

// Refresh icon (SVG arrow circular path)
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

export const UpdateNotificationToast = () => {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateFunction, setUpdateFunction] = useState<(() => Promise<void>) | null>(null);

  useEffect(() => {
    // Only register SW in environments where service worker is supported
    if ("serviceWorker" in navigator) {
      const updateSW = registerSW({
        onNeedRefresh() {
          setNeedRefresh(true);
        },
        onOfflineReady() {
          // Application is cached and ready for offline use
        },
      });
      setUpdateFunction(() => updateSW);
    }
  }, []);

  const handleReload = useCallback(async () => {
    try {
      // Flush pending local edits first to make sure no drawings are lost
      LocalData.flushSave();

      if (updateFunction) {
        // Trigger service worker skipWaiting / reload
        await updateFunction();
      }
    } catch (e) {
      console.error("Failed to update service worker:", e);
    } finally {
      // Force page reload if updateSW doesn't reload immediately
      window.location.reload();
    }
  }, [updateFunction]);

  const handleDismiss = useCallback(() => {
    setNeedRefresh(false);
  }, []);

  if (!needRefresh) {
    return null;
  }

  return (
    <div
      className="update-available-toast"
      role="alert"
      aria-live="polite"
    >
      <div className="update-available-toast__icon">
        <RefreshIcon />
      </div>
      <div className="update-available-toast__text">
        An update is available. Reload to get the latest features?
      </div>
      <div className="update-available-toast__actions">
        <button
          type="button"
          className="update-available-toast__reload-btn"
          onClick={handleReload}
        >
          Reload
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
