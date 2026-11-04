// Checks every excerpt appears word for word in its Gutenberg book, and deletes any that do not.
// Run: node scripts/verify-excerpts.ts
import { writeFileSync } from "node:fs";
import { EXCERPTS } from "../src/spark/excerpts.ts";
import { bookText, excerptsFile, norm } from "./gutenberg.ts";

const books = new Map<number, string>();
const kept = [];
let dropped = 0;
for (const e of EXCERPTS) {
  let book = books.get(e.gutenbergId);
  if (book === undefined) {
    book = norm(await bookText(e.gutenbergId));
    books.set(e.gutenbergId, book);
  }
  if (book.includes(norm(e.text))) {
    kept.push(e);
  } else {
    dropped += 1;
    console.log(`DELETED (not found word for word): ${e.author}, ${e.work}`);
  }
}
writeFileSync("src/spark/excerpts.ts", excerptsFile(kept));
console.log(`verified ${String(kept.length)} excerpts, deleted ${String(dropped)}`);
