import { type AppInfo, commands } from "../contracts";

/** Loads build information from the Rust `app_info` command. Rejects if the IPC call fails. */
export async function loadAppInfo(): Promise<AppInfo> {
  return commands.appInfo();
}
