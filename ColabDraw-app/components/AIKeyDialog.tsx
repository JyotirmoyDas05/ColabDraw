import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import { TextField } from "@excalidraw/excalidraw/components/TextField";
import { useEffect, useState } from "react";

import { useAtom } from "../app-jotai";
import {
  AIError,
  downloadNano,
  getAISettings,
  getNanoAvailability,
  getTrialStatus,
  getUserApiKey,
  setAISettings,
  setUserApiKey,
  validateApiKey,
} from "../ai/aiClient";
import { aiKeyDialogOpenAtom, aiTrialAtom } from "../ai/aiState";

import "./AIKeyDialog.scss";

import type { AISettings } from "../ai/aiClient";

const KEY_PAGE_URL = "https://aistudio.google.com/apikey";

const LANGUAGES = [
  ["", "Browser language"],
  ["en-US", "English (US)"],
  ["en-GB", "English (UK)"],
  ["en-IN", "English (India)"],
  ["hi-IN", "Hindi"],
  ["bn-IN", "Bengali"],
  ["es-ES", "Spanish"],
  ["fr-FR", "French"],
  ["de-DE", "German"],
  ["pt-BR", "Portuguese"],
  ["ja-JP", "Japanese"],
  ["zh-CN", "Chinese"],
] as const;

const AIPreferences = () => {
  const [settings, setSettings] = useState(getAISettings);
  const [nano, setNano] = useState<string>("unavailable");
  const [nanoProgress, setNanoProgress] = useState<number | null>(null);

  useEffect(() => {
    getNanoAvailability().then(setNano);
  }, []);

  const update = (patch: Partial<AISettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    setAISettings(next);
  };

  return (
    <section className="AIKeyDialog__section AIKeyDialog__preferences">
      <label>
        AI model
        <select
          value={settings.engine}
          onChange={(event) =>
            update({ engine: event.target.value as AISettings["engine"] })
          }
        >
          <option value="gemini">Gemini (cloud, best results)</option>
          <option value="nano" disabled={nano === "unavailable"}>
            Gemini Nano (on this device
            {nano === "unavailable" ? ", needs desktop Chrome" : ""})
          </option>
        </select>
      </label>
      {settings.engine === "nano" && nano !== "available" && (
        <div>
          <FilledButton
            variant="outlined"
            label={
              nanoProgress === null
                ? "Download Gemini Nano"
                : `Downloading… ${Math.round(nanoProgress * 100)}%`
            }
            status={nanoProgress === null ? null : "loading"}
            onClick={async () => {
              setNanoProgress(0);
              try {
                await downloadNano(setNanoProgress);
                setNano("available");
              } finally {
                setNanoProgress(null);
              }
            }}
          />
        </div>
      )}
      <label>
        Voice input
        <select
          value={settings.speech}
          onChange={(event) =>
            update({ speech: event.target.value as AISettings["speech"] })
          }
        >
          <option value="auto">Automatic (always on this device)</option>
          <option value="whisper">
            Whisper model (on this device, one-time download)
          </option>
          <option value="browser">Browser speech (may use the cloud)</option>
        </select>
      </label>
      <label>
        Speech language
        <select
          value={settings.speechLang}
          onChange={(event) => update({ speechLang: event.target.value })}
        >
          {LANGUAGES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="AIKeyDialog__checkbox">
        <input
          type="checkbox"
          checked={settings.autoSend}
          onChange={(event) => update({ autoSend: event.target.checked })}
        />
        Send voice commands when I stop talking
      </label>
    </section>
  );
};

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
      <AIPreferences />
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
