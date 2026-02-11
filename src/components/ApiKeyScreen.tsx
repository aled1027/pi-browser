import { useState } from "react";
import "./ApiKeyScreen.css";

interface Props {
  initialKey: string;
  onStart: (key: string) => void;
}

export function ApiKeyScreen({ initialKey, onStart }: Props) {
  const [key, setKey] = useState(initialKey);

  return (
    <div className="apikey-screen">
      <div className="apikey-card">
        <h1>π browser</h1>
        <p className="subtitle">A browser-based coding agent</p>
        <label htmlFor="api-key">OpenRouter API Key</label>
        <input
          id="api-key"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-or-..."
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && key.trim()) onStart(key.trim());
          }}
        />
        <button disabled={!key.trim()} onClick={() => onStart(key.trim())}>
          Start
        </button>
        <p className="hint">
          Key is stored in localStorage. Get one at{" "}
          <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
            openrouter.ai/keys
          </a>
        </p>
      </div>
    </div>
  );
}
