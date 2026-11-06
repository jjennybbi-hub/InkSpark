# InkSpark: Version 1 Spec

This is the agreed description of version 1. If it disagrees with `PLAN.md` or `PLAN-LITE.md`, this file wins. `PLAN.md` remains the long-term vision and the source for everything after version 1.

## What it is

A calm writing app for the Mac. You open it and write, and it never loses a word. It is the base for a bigger writing app later, so version 1 must leave room to grow without redoing work.

## Who it is for

- **Version 1:** only the owner, on the owner's Mac.
- **The owner writes:** novels and fiction, chat-style stories, scripts, and non-fiction.
- **Later:** possibly a wider audience. Nothing in version 1 is built for selling, but nothing should block it.

## What it must do

### Already built

- **Projects:** a project is a folder you pick, and the app reopens the last one.
- **Pages:** add pages and switch between them. A page's first line is its title.
- **Saving:** saves about a second after you stop typing and on ⌘S, with a quiet status dot. Keeps the last 50 versions of each page.
- **Writing:** formatting popup on selected text, with headings, fonts, sizes, colours, highlights, lists, quotes and alignment.
- **Look:** grouped themes, your own themes, separate text and interface fonts, text size, page width, and Compact, Open and Relaxed reading looks.
- **Focus mode:** ⌘⇧F to enter, Esc to leave.
- **Idea Shelf:** quick notes in a side column.
- **Prompts:** a button that deals prompts and real cited passages, never repeating one.
- **Read aloud:** reads selected text in the Mac's own voice, to help proofreading. The real voice still needs the owner's test.
- **Export:** one page or all pages, to Markdown or Word.

### Still to build

1. **Delete and rename pages:** a deleted page can be brought back.
2. **Chapters and folders:** group pages and drag them into order.
3. **Search:** find any word across the whole project.
4. **Old versions screen:** see the saved versions of a page and restore one.
5. **Automatic backups:** a dated copy of the project goes to a folder you pick. That can be an external drive or a folder your Mac syncs itself.
6. **Cast list:** each project has its own list of characters, places and events.
   - The icon sits in the bottom-right row, beside Export and the gear, and the list floats over the page.
   - Add with "+", and rename or remove in the same list.
   - Renaming a character updates their name throughout the page.
   - Typing @ suggests names from the list.
   - A new name typed in a chat joins the list automatically.
7. **Writing formats:** Normal and Chat history.
   - The format works section by section. "Whole page" simply means every section.
   - You can switch format at any time, and your original text is kept.
   - New formats must slot in later without redoing this work.
8. **Chat history format:** looks like a real messaging app in an iMessage-like style.
   - Bubbles on the left and right, contact name and picture circle, timestamps and typing bar.
   - Enter finishes a line and moves to the next speaker.
   - Tab changes the speaker, and clicking a bubble's name or side does too.
   - Pages stay readable as plain text, such as `Annie: hello`.

## What it must never do

- **Lose a word:** every save goes through the one safe saving path, and earlier versions stay recoverable.
- **Nag:** no goals, streaks, praise, badges or popups aimed at the writer. Word counts appear only in a future Publish area.
- **Write for you:** AI never writes or rewrites your text.
- **Invent quotes:** quotes and passages are real, by real people, and show their source.
- **Go online:** version 1 works fully offline and never connects to the internet. No accounts, servers or tracking.
- **Hide your work:** your writing stays in files other apps can open.
- **Force steps:** no required setup or order. You can always just open it and write.
- **Shift the page:** menus, settings and pickers float over the page, and toolbars keep a fixed height. App controls are icon buttons with tooltips, and text formatting stays separate from app appearance.
- **Touch what it wasn't asked to:** exports never replace pages or their history.

### Prompt labels

Prompts show no "AI-drafted" label. This is the owner's decision. If the owner publishes, they will state that the whole work is AI-made. Quotes keep their sources.

## What is left out of version 1

- **Coming first after version 1, in either order:**
  - Planning tools: outline, board, timeline and story bible.
  - Sparks and packs: image sparks, wider sources, Craft Library, genre packs and offline encyclopedias.
- **Formats:** Screenplay and Stage play are next in line for formats. The WhatsApp-like, Discord-like and SMS chat styles also wait.
- **Later, as `PLAN.md` describes:**
  - Revision marks and snapshot comparison
  - Book publishing: EPUB, print PDF, manuscript format and cover template
  - Importing from other apps
  - Music, ambience and places
  - Voice notes and typing by voice
  - The ⌘K command palette
  - Other project types
  - Writing checkers and analysis tools
  - Feedback and track changes
  - Syncing between devices, and a phone app
  - Translated menus
- **Other computers:** Windows and Linux.
- **Selling:** price, licensing checks, trademark search, code signing and a public test.

## When version 1 is finished

All of the following are true:

1. Everything on the "Still to build" list works.
2. The owner has written a real project in the app for two weeks.
3. In that time, nothing was lost and no other writing app was needed.

## Decisions that replace the older plans

| Topic     | Older plan                            | Now                                 |
| --------- | ------------------------------------- | ----------------------------------- |
| Computers | Mac, Windows and Linux                | Mac only for version 1              |
| Size      | Eight large milestones                | Small plan plus the list above      |
| Prompts   | AI-drafted text labelled              | No AI label                         |
| Internet  | Some live sources                     | None in version 1                   |
| Formats   | Fiction and Non-fiction project types | Normal and Chat history, by section |

## How to build it

- One small step per session, in the order above, with the queue kept in `NEXT-STEP.txt`.
- Every step ends with checks and tests, the safe app install, a commit and a push.
- Conventions and app-update rules stay in `CLAUDE.md`.

## Open details, using these defaults unless the owner says otherwise

- **Backup timing:** once a day, when the app opens or closes, keeping the last 30 copies.
- **Deleted pages:** kept in a Recently Deleted list inside the project until you remove them.
- **Read aloud:** uses the Mac's on-device voices, to honour the no-internet rule.
