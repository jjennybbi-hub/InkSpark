import { type JSX, useEffect, useState } from "react";
import type { AppInfo } from "../contracts";
import { loadAppInfo } from "./appInfo";
import "./shell.css";

/**
 * The calm, empty shell (M0 §3.4): one `main` landmark and a visually hidden heading.
 * No buttons, text, dialogs, toasts, goals or streaks.
 */
export function App(): JSX.Element {
  const [info, setInfo] = useState<AppInfo | undefined>(undefined);

  useEffect(() => {
    let active = true;
    loadAppInfo().then(
      (loaded) => {
        if (active) {
          setInfo(loaded);
        }
      },
      (error: unknown) => {
        // The shell stays quiet: no UI for this, but the failure is reported, not swallowed.
        console.error("InkSpark could not load app info:", error);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <main
      className="app-shell"
      data-testid="app-shell"
      aria-label="InkSpark"
      data-app-version={info?.version ?? ""}
    >
      <h1 className="visually-hidden">InkSpark</h1>
    </main>
  );
}
