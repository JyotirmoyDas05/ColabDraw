import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import { TextField } from "@excalidraw/excalidraw/components/TextField";
import { useEffect, useState } from "react";

import { useAtom } from "../app-jotai";
import {
  AIError,
  getTrialStatus,
  getUserApiKey,
  setUserApiKey,
  validateApiKey,
} from "../ai/aiClient";
import { aiKeyDialogOpenAtom, aiTrialAtom } from "../ai/aiState";

import "./AIKeyDialog.scss";

const KEY_PAGE_URL = "https://aistudio.google.com/apikey";

const AIKeyDialogContent = ({ onClose }: { onClose: () => void }) => {
  const [trial, setTrial] = useAtom(aiTrialAtom);
  const [savedKey, setSavedKey] = useState(getUserApiKey);
  const [keyInput, setKeyInput] = useState("");
  const [status, setStatus] = useState<null | "loading" | "success">(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTrialStatus().then(setTrial);
  }, [setTrial]);

  const saveKey = async () => {
    const key = keyInput.trim();
    if (!key) {
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      await validateApiKey(key);
      setUserApiKey(key);
      setSavedKey(key);
      setKeyInput("");
      setStatus("success");
    } catch (err) {
      setStatus(null);
      setError(
        err instanceof AIError && err.code === "invalid_key"
          ? "That key didn't work. Check you copied the whole key."
          : "Couldn't reach Google to check the key. Try again.",
      );
    }
  };

  const removeKey = () => {
    setUserApiKey(null);
    setSavedKey(null);
    setStatus(null);
  };

  return (
    <div className="AIKeyDialog">
      {savedKey ? (
        <section className="AIKeyDialog__section">
          <p>
            <strong>Using your own Gemini key</strong> (…{savedKey.slice(-4)}).
            Requests go straight from this browser to Google and count against
            your key's free daily limit.
          </p>
          <FilledButton
            variant="outlined"
            color="danger"
            label="Remove key"
            onClick={removeKey}
          />
        </section>
      ) : (
        <>
          <section className="AIKeyDialog__section">
            <p>
              <strong>Free trial:</strong>{" "}
              {trial === null
                ? "checking…"
                : !trial.enabled
                ? "not available right now."
                : `${trial.remaining} of ${trial.limit} requests left today.`}
            </p>
            <p className="AIKeyDialog__muted">
              Want more? A personal Gemini key is free and takes about two
              minutes.
            </p>
          </section>
          <section className="AIKeyDialog__section">
            <ol className="AIKeyDialog__steps">
              <li>
                Open{" "}
                <a
                  href={KEY_PAGE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google AI Studio
                </a>{" "}
                and sign in with a Google account.
              </li>
              <li>
                Click <strong>Create API key</strong> and copy it.
              </li>
              <li>Paste it below.</li>
            </ol>
            <TextField
              label="Gemini API key"
              placeholder="AIza…"
              value={keyInput}
              onChange={setKeyInput}
              isRedacted
              fullWidth
              onKeyDown={(event) => event.key === "Enter" && saveKey()}
            />
            {error && <p className="AIKeyDialog__error">{error}</p>}
            <FilledButton
              label="Save key"
              status={status}
              disabled={!keyInput.trim()}
              onClick={saveKey}
            />
          </section>
        </>
      )}
      <p className="AIKeyDialog__muted">
        Your key is stored only in this browser and never sent to ColabDraw's
        servers.
      </p>
      {status === "success" && (
        <FilledButton variant="outlined" label="Done" onClick={onClose} />
      )}
    </div>
  );
};

export const AIKeyDialog = () => {
  const [isOpen, setIsOpen] = useAtom(aiKeyDialogOpenAtom);
  if (!isOpen) {
    return null;
  }
  const close = () => setIsOpen(false);
  return (
    <Dialog size="small" onCloseRequest={close} title="AI settings">
      <AIKeyDialogContent onClose={close} />
    </Dialog>
  );
};
