import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { nextSpeaker, renameOnPage, sectionRange, setFormat, speakerOf, timeOf } from "./chat";
import { editorExtensions } from "./editorExtensions";
import { pageToBlocks } from "./exportDoc";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function make(markdown: string, cast: readonly string[] = []): Editor {
  editor = new Editor({ extensions: editorExtensions(() => cast), content: markdown });
  return editor;
}

function press(e: Editor, key: string): void {
  const event = new KeyboardEvent("keydown", { key, bubbles: true });
  e.view.someProp("handleKeyDown", (f) => f(e.view, event));
}

function md(e: Editor): string {
  return (
    e.storage as unknown as { markdown: { getMarkdown: () => string } }
  ).markdown.getMarkdown();
}

const CHAT = '<div data-chat="Annie">\n\nAnnie: hello\n\nBob: hi there\n\n</div>';

describe("chat history", () => {
  it("reads a typed time before the speaker", () => {
    expect(timeOf("[9:41] Annie: hello")).toBe("9:41");
    expect(speakerOf("[9:41] Annie: hello")).toBe("Annie");
    expect(timeOf("Annie: hello")).toBe("");
  });

  it("keeps a typed time exactly when saving and switching formats", () => {
    const timed = '<div data-chat="Annie">\n\n[9:41] Annie: hello\n\n[9:41] Bob: hi\n\n</div>';
    const e = make(timed);
    expect(make(md(e)).getText()).toContain("[9:41] Annie: hello");
    const { from, to } = sectionRange(e.state);
    setFormat(e, "normal", from, to);
    expect(e.getText()).toContain("[9:41] Annie: hello");
  });

  it("shows the time label only when the time changes", () => {
    const e = make(
      '<div data-chat="Annie">\n\n[9:41] Annie: a\n\n[9:41] Bob: b\n\n[9:45] Annie: c\n\n</div>',
    );
    const marks = [...e.view.dom.querySelectorAll(".chat-line")].map((n) =>
      n.getAttribute("data-time"),
    );
    expect(marks).toEqual(["shown", "same", "shown"]);
  });

  it("reads the speaker from the start of a line", () => {
    expect(speakerOf("Annie: hello")).toBe("Annie");
    expect(speakerOf("no speaker here")).toBe("");
  });

  it("saves as plain Name: lines and reads back the same", () => {
    const e = make(CHAT);
    expect(e.getJSON().content?.[0]?.type).toBe("chatSection");
    expect(md(e)).toBe(CHAT);
    expect(md(make(md(e)))).toBe(CHAT);
  });

  it("switching to chat and back keeps every word", () => {
    const original = "# Day one\n\nAnnie: hello\n\nBob: *hi* there\n\n# Day two\n\nLater.";
    const e = make(original);
    e.commands.setTextSelection(10);
    const range = sectionRange(e.state);
    setFormat(e, "chat", range.from, range.to);
    expect(e.getJSON().content?.map((n) => n.type)).toEqual([
      "heading",
      "chatSection",
      "heading",
      "paragraph",
    ]);
    setFormat(e, "normal", 0, e.state.doc.content.size);
    expect(md(e)).toBe(original);
  });

  it("Enter moves to the other speaker", () => {
    const e = make(CHAT);
    const section = e.state.doc.child(0);
    expect(nextSpeaker(section, 1, [])).toBe("Annie");
    e.commands.setTextSelection(e.state.doc.child(0).nodeSize - 2);
    press(e, "Enter");
    expect(md(e)).toContain("Bob: hi there\n\nAnnie: \n");
  });

  it("Tab changes the speaker without touching the words", () => {
    const e = make(CHAT, ["Cleo"]);
    e.commands.setTextSelection(e.state.doc.child(0).nodeSize - 2);
    press(e, "Tab");
    expect(md(e)).toContain("Cleo: hi there");
  });

  it("renaming updates speakers and mentions", () => {
    const e = make(`${CHAT}\n\nAnnie left. Annielle stayed.`);
    renameOnPage(e, "Annie", "Ann");
    const text = md(e);
    expect(text).toContain('data-chat="Ann"');
    expect(text).toContain("Ann: hello");
    expect(text).toContain("Ann left. Annielle stayed.");
  });

  it("Word export keeps chat lines, the right-hand speaker on the right", () => {
    const blocks = pageToBlocks(CHAT);
    expect(blocks.map((b) => b.align ?? null)).toEqual(["right", null]);
    expect(blocks[1]?.runs[0]?.text).toBe("Bob: hi there");
  });
});
