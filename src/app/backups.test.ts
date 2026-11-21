import { describe, expect, it } from "vitest";
import { backupFolder, backupStamp, describeStamp, setBackupFolder } from "./backups";

describe("backups", () => {
  it("stamps in local time", () => {
    expect(backupStamp(new Date(2026, 10, 21, 9, 5))).toBe("2026-11-21 0905");
  });
  it("describes a stamp with the time", () => {
    expect(describeStamp("2026-11-21 0905")).toContain("09:05");
    expect(describeStamp("odd")).toBe("odd");
  });
  it("remembers and clears the folder", () => {
    setBackupFolder("/Volumes/Drive");
    expect(backupFolder()).toBe("/Volumes/Drive");
    setBackupFolder(null);
    expect(backupFolder()).toBeNull();
  });
});
