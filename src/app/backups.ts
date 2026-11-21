import { commands } from "../contracts";

const FOLDER_KEY = "inkspark.backupFolder";

/** The folder backups go to, or null when backups are off. Kept per Mac, not in the project. */
export function backupFolder(): string | null {
  try {
    return localStorage.getItem(FOLDER_KEY);
  } catch {
    return null;
  }
}

export function setBackupFolder(path: string | null): void {
  try {
    if (path === null) {
      localStorage.removeItem(FOLDER_KEY);
    } else {
      localStorage.setItem(FOLDER_KEY, path);
    }
  } catch {
    // Without storage, backups simply stay off.
  }
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** `YYYY-MM-DD HHMM` in local time; also the name of each backup folder. */
export function backupStamp(at: Date = new Date()): string {
  return `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}${pad(at.getMinutes())}`;
}

/** Shows a stamp as "21 Nov 2026, 09:30". */
export function describeStamp(stamp: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})$/.exec(stamp);
  if (m === null) {
    return stamp;
  }
  const [, y, mo, d, h, mi] = m;
  const when = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  return `${when.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}, ${h ?? ""}:${mi ?? ""}`;
}

/** Makes today's backup if there isn't one yet. Quiet: a failure is only logged. */
export async function dailyBackup(project: string): Promise<void> {
  const dest = backupFolder();
  if (dest === null) {
    return;
  }
  const result = await commands.backupProject(project, dest, backupStamp(), true);
  if (result.status === "error") {
    console.warn("InkSpark backup skipped:", result.error.message);
  }
}
