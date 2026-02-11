import { useState, useRef, useCallback } from "react";
import { Agent } from "./agent";
import { ApiKeyScreen } from "./components/ApiKeyScreen";
import { Chat } from "./components/Chat";
import "./App.css";

export function App() {
  const [apiKey, setApiKey] = useState<string>(
    () => localStorage.getItem("pi-browser-api-key") ?? ""
  );
  const [started, setStarted] = useState(false);
  const agentRef = useRef<Agent | null>(null);

  const handleStart = useCallback(
    (key: string) => {
      localStorage.setItem("pi-browser-api-key", key);
      setApiKey(key);
      agentRef.current = new Agent({ apiKey: key });
      setStarted(true);
    },
    []
  );

  if (!started) {
    return <ApiKeyScreen initialKey={apiKey} onStart={handleStart} />;
  }

  return <Chat agent={agentRef.current!} />;
}
