import { open } from "@tauri-apps/plugin-dialog";
import { type JSX, useEffect, useState } from "react";
import { commands } from "../contracts";
import { backupFolder, backupStamp, describeStamp, setBackupFolder } from "./backups";

/** The Backups part of the gear overlay: pick a folder, see the last copy, back up now. */
export function BackupSettings({ project }: { project: string }): JSX.Element {
  const [folder, setFolder] = useState<string | null>(backupFolder);
  const [last, setLast] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (folder === null) {
      return;
    }
    let stale = false;
    commands.lastBackup(project, folder).then(
      (r) => {
        if (!stale) {
          setLast(r.status === "ok" ? r.data : null);
        }
      },
      () => {
        if (!stale) {
          setLast(null);
        }
      },
    );
    return () => {
      stale = true;
    };
  }, [project, folder]);

  const backUp = async (dest: string, daily: boolean): Promise<void> => {
    setBusy(true);
    try {
      const r = await commands.backupProject(project, dest, backupStamp(), daily);
      if (r.status === "ok") {
        setNote("");
        const done = await commands.lastBackup(project, dest);
        setLast(done.status === "ok" ? done.data : null);
      } else {
        setNote(`The backup could not be made: ${r.error.message}`);
      }
    } catch {
      setNote("The backup could not be made.");
    } finally {
      setBusy(false);
    }
  };

  const choose = async (): Promise<void> => {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === "string") {
        setBackupFolder(picked);
        setFolder(picked);
        await backUp(picked, true);
      }
    } catch {
      setNote("The folder picker could not open.");
    }
  };

  return (
    <>
      <h2>Backups</h2>
      <p className="hint">
        {folder === null
          ? "Off. Pick a folder, such as an external drive, to keep a dated copy of this project once a day (the last 30 are kept)."
          : `To ${folder}. ${last === null ? "No copy yet." : `Last copy: ${describeStamp(last)}.`}`}
      </p>
      <div className="font-row">
        <button type="button" title="Choose the folder backups go to" onClick={() => void choose()}>
          {folder === null ? "Choose folder…" : "Change folder…"}
        </button>
        {folder !== null && (
          <>
            <button
              type="button"
              disabled={busy}
              title="Make a backup copy now"
              onClick={() => void backUp(folder, false)}
            >
              {busy ? "Backing up…" : "Back up now"}
            </button>
            <button
              type="button"
              title="Stop making backups. Copies already made stay where they are."
              onClick={() => {
                setBackupFolder(null);
                setFolder(null);
                setLast(null);
                setNote("");
              }}
            >
              Turn off
            </button>
          </>
        )}
      </div>
      {note !== "" && (
        <p className="hint" role="status">
          {note}
        </p>
      )}
    </>
  );
}
