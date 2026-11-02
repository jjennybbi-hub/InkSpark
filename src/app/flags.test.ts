import { describe, expect, it } from "vitest";
import {
  FLAG_DEFINITIONS,
  type FlagName,
  flags,
  isEnabled,
  parseFlagOverrides,
  resolveFlags,
} from "./flags";

const FLAG_NAMES = Object.keys(FLAG_DEFINITIONS) as FlagName[];

describe("FLAG_DEFINITIONS", () => {
  it("defines at least one flag", () => {
    expect(FLAG_NAMES.length).toBeGreaterThan(0);
  });

  it.each(FLAG_NAMES)("%s defaults to off", (name) => {
    expect(FLAG_DEFINITIONS[name].default).toBe(false);
  });

  it.each(FLAG_NAMES)("%s has a non-empty description", (name) => {
    const { description } = FLAG_DEFINITIONS[name];
    expect(typeof description).toBe("string");
    expect(description.trim().length).toBeGreaterThan(0);
  });

  it.each(FLAG_NAMES)("%s names the milestone that will accept it", (name) => {
    expect(FLAG_DEFINITIONS[name].milestone).toMatch(/^M\d+$/);
  });
});

describe("resolveFlags", () => {
  it("returns every flag set to false when there are no overrides", () => {
    const resolved = resolveFlags(undefined);
    expect(Object.keys(resolved).sort()).toEqual([...FLAG_NAMES].sort());
    for (const name of FLAG_NAMES) {
      expect(resolved[name]).toBe(false);
    }
  });

  it("returns a frozen object", () => {
    expect(Object.isFrozen(resolveFlags(undefined))).toBe(true);
    expect(Object.isFrozen(resolveFlags("readerView"))).toBe(true);
  });

  it("applies enables and disables on top of the defaults", () => {
    const resolved = resolveFlags("readerView, -dictation ,bogus");
    expect(resolved.readerView).toBe(true);
    expect(resolved.dictation).toBe(false);
    for (const name of FLAG_NAMES) {
      if (name !== "readerView") {
        expect(resolved[name]).toBe(false);
      }
    }
  });

  it("lets a later -name override an earlier name", () => {
    expect(resolveFlags("readerView,-readerView").readerView).toBe(false);
    expect(resolveFlags("dictation, encyclopedia, -dictation").dictation).toBe(false);
    expect(resolveFlags("dictation, encyclopedia, -dictation").encyclopedia).toBe(true);
  });

  it.each(["", "   ", "\t", " \n "])("treats %j as a no-op", (raw) => {
    expect(resolveFlags(raw)).toEqual(resolveFlags(undefined));
  });

  it("never throws on unknown names", () => {
    expect(() => resolveFlags("bogus,-alsoBogus, ,,")).not.toThrow();
    expect(resolveFlags("bogus,-alsoBogus")).toEqual(resolveFlags(undefined));
  });

  it("does not leak unknown names into the result", () => {
    expect(Object.keys(resolveFlags("bogus")).sort()).toEqual([...FLAG_NAMES].sort());
  });
});

describe("parseFlagOverrides", () => {
  it("splits enables, disables and unknown names, tolerating whitespace", () => {
    expect(parseFlagOverrides("readerView, -dictation ,bogus")).toEqual({
      enabled: ["readerView"],
      disabled: ["dictation"],
      unknown: ["bogus"],
    });
  });

  it("returns empty lists for undefined input", () => {
    expect(parseFlagOverrides(undefined)).toEqual({ enabled: [], disabled: [], unknown: [] });
  });

  it.each(["", "   ", "\t", " \n "])("returns empty lists for %j", (raw) => {
    expect(parseFlagOverrides(raw)).toEqual({ enabled: [], disabled: [], unknown: [] });
  });

  it("collects unknown names instead of throwing", () => {
    expect(() => parseFlagOverrides("nope,-nada")).not.toThrow();
    const parsed = parseFlagOverrides("nope");
    expect(parsed.enabled).toEqual([]);
    expect(parsed.disabled).toEqual([]);
    expect(parsed.unknown).toEqual(["nope"]);
  });
});

describe("flags and isEnabled", () => {
  it("exposes a frozen flags object covering every flag", () => {
    expect(Object.isFrozen(flags)).toBe(true);
    expect(Object.keys(flags).sort()).toEqual([...FLAG_NAMES].sort());
  });

  it.each(FLAG_NAMES)("isEnabled(%s) agrees with flags", (name) => {
    expect(isEnabled(name)).toBe(flags[name]);
  });
});
