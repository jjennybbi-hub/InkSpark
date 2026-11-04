// Picks excerpts by rule from Gutenberg books and writes src/spark/excerpts.ts.
// No excerpt text is ever typed by hand: openings are the first sentence(s) of chapter one,
// passages are the first fitting paragraph after the midpoint of the book.
// Run: node scripts/build-excerpts.ts
import { writeFileSync } from "node:fs";
import { bodyOf, bookText, excerptsFile, norm, titleOf, type Excerpt } from "./gutenberg.ts";

// [gutenbergId, author, work, year, title check, also take a passage]
type Book = [number, string, string, number, string, boolean];
const BOOKS: Book[] = [
  [1342, "Jane Austen", "Pride and Prejudice", 1813, "Pride and Prejudice", true],
  [158, "Jane Austen", "Emma", 1815, "Emma", false],
  [161, "Jane Austen", "Sense and Sensibility", 1811, "Sense and Sensibility", false],
  [121, "Jane Austen", "Northanger Abbey", 1817, "Northanger", false],
  [105, "Jane Austen", "Persuasion", 1817, "Persuasion", false],
  [141, "Jane Austen", "Mansfield Park", 1814, "Mansfield", false],
  [11, "Lewis Carroll", "Alice's Adventures in Wonderland", 1865, "Alice", true],
  [84, "Mary Shelley", "Frankenstein", 1818, "Frankenstein", true],
  [1661, "Arthur Conan Doyle", "The Adventures of Sherlock Holmes", 1892, "Sherlock", true],
  [244, "Arthur Conan Doyle", "A Study in Scarlet", 1887, "Study in Scarlet", false],
  [2852, "Arthur Conan Doyle", "The Hound of the Baskervilles", 1902, "Baskervilles", false],
  [2701, "Herman Melville", "Moby-Dick", 1851, "Moby", true],
  [98, "Charles Dickens", "A Tale of Two Cities", 1859, "Tale of Two Cities", true],
  [1400, "Charles Dickens", "Great Expectations", 1861, "Great Expectations", true],
  [730, "Charles Dickens", "Oliver Twist", 1838, "Oliver Twist", false],
  [766, "Charles Dickens", "David Copperfield", 1850, "David Copperfield", false],
  [1023, "Charles Dickens", "Bleak House", 1853, "Bleak House", false],
  [786, "Charles Dickens", "Hard Times", 1854, "Hard Times", false],
  [46, "Charles Dickens", "A Christmas Carol", 1843, "Christmas Carol", false],
  [74, "Mark Twain", "The Adventures of Tom Sawyer", 1876, "Tom Sawyer", true],
  [76, "Mark Twain", "Adventures of Huckleberry Finn", 1884, "Huckleberry", true],
  [345, "Bram Stoker", "Dracula", 1897, "Dracula", false],
  [174, "Oscar Wilde", "The Picture of Dorian Gray", 1890, "Dorian Gray", true],
  [1260, "Charlotte Brontë", "Jane Eyre", 1847, "Jane Eyre", true],
  [768, "Emily Brontë", "Wuthering Heights", 1847, "Wuthering", true],
  [2554, "Fyodor Dostoevsky", "Crime and Punishment", 1866, "Crime and Punishment", true],
  [2600, "Leo Tolstoy", "War and Peace", 1869, "War and Peace", false],
  [1399, "Leo Tolstoy", "Anna Karenina", 1878, "Anna Karenina", false],
  [28054, "Fyodor Dostoevsky", "The Brothers Karamazov", 1880, "Karamazov", false],
  [600, "Fyodor Dostoevsky", "Notes from the Underground", 1864, "Underground", true],
  [2638, "Fyodor Dostoevsky", "The Idiot", 1869, "Idiot", false],
  [996, "Miguel de Cervantes", "Don Quixote", 1605, "Don Quixote", true],
  [135, "Victor Hugo", "Les Misérables", 1862, "Mis", false],
  [1184, "Alexandre Dumas", "The Count of Monte Cristo", 1844, "Monte Cristo", false],
  [1257, "Alexandre Dumas", "The Three Musketeers", 1844, "Three Musketeers", false],
  [36, "H. G. Wells", "The War of the Worlds", 1898, "War of the Worlds", true],
  [35, "H. G. Wells", "The Time Machine", 1895, "Time Machine", true],
  [5230, "H. G. Wells", "The Invisible Man", 1897, "Invisible Man", false],
  [159, "H. G. Wells", "The Island of Doctor Moreau", 1896, "Moreau", false],
  [164, "Jules Verne", "Twenty Thousand Leagues Under the Sea", 1870, "Twenty Thousand", false],
  [103, "Jules Verne", "Around the World in Eighty Days", 1872, "Around the World", false],
  [83, "Jules Verne", "From the Earth to the Moon", 1865, "Earth to the Moon", false],
  [120, "Robert Louis Stevenson", "Treasure Island", 1883, "Treasure Island", true],
  [43, "Robert Louis Stevenson", "Strange Case of Dr Jekyll and Mr Hyde", 1886, "Jekyll", false],
  [209, "Henry James", "The Turn of the Screw", 1898, "Turn of the Screw", false],
  [219, "Joseph Conrad", "Heart of Darkness", 1899, "Heart of Darkness", true],
  [1952, "Charlotte Perkins Gilman", "The Yellow Wallpaper", 1892, "Yellow", false],
  [514, "Louisa May Alcott", "Little Women", 1868, "Little Women", false],
  [45, "L. M. Montgomery", "Anne of Green Gables", 1908, "Anne of Green Gables", false],
  [55, "L. Frank Baum", "The Wonderful Wizard of Oz", 1900, "Wizard of Oz", false],
  [16, "J. M. Barrie", "Peter Pan", 1911, "Peter Pan", false],
  [113, "Frances Hodgson Burnett", "The Secret Garden", 1911, "Secret Garden", false],
  [236, "Rudyard Kipling", "The Jungle Book", 1894, "Jungle Book", false],
  [215, "Jack London", "The Call of the Wild", 1903, "Call of the Wild", true],
  [910, "Jack London", "White Fang", 1906, "White Fang", false],
  [1727, "Homer", "The Odyssey (Samuel Butler, trans.)", -700, "Odyssey", true],
  [2680, "Marcus Aurelius", "Meditations (George Long, trans.)", 180, "Meditations", true],
  [132, "Sun Tzu", "The Art of War (Lionel Giles, trans.)", -500, "Art of War", true],
  [1497, "Plato", "The Republic (Benjamin Jowett, trans.)", -375, "Republic", false],
  [1232, "Niccolò Machiavelli", "The Prince (W. K. Marriott, trans.)", 1532, "Prince", true],
  [829, "Jonathan Swift", "Gulliver's Travels", 1726, "Gulliver", true],
  [521, "Daniel Defoe", "Robinson Crusoe", 1719, "Robinson Crusoe", false],
  [4300, "James Joyce", "Ulysses", 1922, "Ulysses", false],
  [2814, "James Joyce", "Dubliners", 1914, "Dubliners", false],
  [
    4217,
    "James Joyce",
    "A Portrait of the Artist as a Young Man",
    1916,
    "Portrait of the Artist",
    false,
  ],
  [5200, "Franz Kafka", "Metamorphosis (David Wyllie, trans.)", 1915, "Metamorphosis", true],
  [7849, "Franz Kafka", "The Trial (David Wyllie, trans.)", 1925, "Trial", false],
  [205, "Henry David Thoreau", "Walden", 1854, "Walden", true],
  [33, "Nathaniel Hawthorne", "The Scarlet Letter", 1850, "Scarlet Letter", false],
  [145, "George Eliot", "Middlemarch", 1871, "Middlemarch", true],
  [550, "George Eliot", "Silas Marner", 1861, "Silas Marner", false],
  [599, "William Makepeace Thackeray", "Vanity Fair", 1848, "Vanity Fair", false],
  [2009, "Charles Darwin", "On the Origin of Species", 1859, "Origin of Species", true],
  [3207, "Thomas Hobbes", "Leviathan", 1651, "Leviathan", false],
  [
    1998,
    "Friedrich Nietzsche",
    "Thus Spake Zarathustra (Thomas Common, trans.)",
    1883,
    "Zarathustra",
    false,
  ],
  [2500, "Hermann Hesse", "Siddhartha (Gunther Olesch et al., trans.)", 1922, "Siddhartha", true],
  [2542, "Henrik Ibsen", "A Doll's House (R. Farquharson Sharp, trans.)", 1879, "Doll", false],
  [2641, "E. M. Forster", "A Room with a View", 1908, "Room with a View", false],
  [863, "Agatha Christie", "The Mysterious Affair at Styles", 1920, "Styles", false],
  [64317, "F. Scott Fitzgerald", "The Great Gatsby", 1925, "Gatsby", true],
  [2148, "Edgar Allan Poe", "The Works of Edgar Allan Poe, Volume 2", 1840, "Poe", false],
  [967, "Charles Dickens", "Nicholas Nickleby", 1839, "Nickleby", false],
  [580, "Charles Dickens", "The Pickwick Papers", 1837, "Pickwick", false],
  [1080, "Jonathan Swift", "A Modest Proposal", 1729, "Modest Proposal", false],
  [3600, "Michel de Montaigne", "Essays (Charles Cotton, trans.)", 1580, "Montaigne", true],
  [
    2388,
    "Edwin Arnold (trans.)",
    "The Song Celestial (Bhagavad-Gita)",
    -200,
    "Song Celestial",
    false,
  ],
  [216, "Laozi", "Tao Te Ching (trans.)", -400, "Tao", false],
  [3330, "Confucius", "The Analects (trans.)", -475, "Analects", false],
  [5827, "Murasaki Shikibu", "The Tale of Genji (Suematsu, trans.)", 1010, "Genji", false],
  [10, "Anonymous", "The King James Bible", 1611, "Bible", false],
  [2591, "Brothers Grimm", "Grimms' Fairy Tales", 1812, "Grimm", true],
  [1597, "Hans Christian Andersen", "Andersen's Fairy Tales", 1837, "Andersen", true],
  [
    128,
    "Anonymous",
    "The Arabian Nights Entertainments (Andrew Lang, ed.)",
    1898,
    "Arabian Nights",
    true,
  ],
  [19942, "Thomas Hardy", "Tess of the d'Urbervilles", 1891, "Tess", false],
  [110, "Thomas Hardy", "Tess of the d'Urbervilles", 1891, "Tess", false],
  [107, "Thomas Hardy", "Far from the Madding Crowd", 1874, "Madding", false],
  [3825, "George Bernard Shaw", "Pygmalion", 1913, "Pygmalion", false],
  [1250, "Anthony Hope", "The Prisoner of Zenda", 1894, "Zenda", false],
  [2166, "H. Rider Haggard", "King Solomon's Mines", 1885, "Solomon", false],
  [1064, "Edgar Allan Poe", "The Masque of the Red Death", 1842, "Masque", false],
  [67098, "Virginia Woolf", "Mrs Dalloway", 1925, "Dalloway", false],
  [144, "Virginia Woolf", "The Voyage Out", 1915, "Voyage Out", false],
  [158, "Jane Austen", "Emma", 1815, "Emma", false],
  [208, "Daisy Ashford", "The Young Visiters", 1919, "Visiters", false],
  [2488, "Jules Verne", "Journey to the Center of the Earth", 1864, "Centre", false],
  [18857, "Jules Verne", "A Journey to the Centre of the Earth", 1864, "Centre", false],
  [1268, "Mark Twain", "The Mysterious Stranger", 1916, "Stranger", false],
  [3176, "Mark Twain", "The Innocents Abroad", 1869, "Innocents", false],
  [119, "Arthur Conan Doyle", "A Study in Scarlet", 1887, "Scarlet", false],
  [2097, "Arthur Conan Doyle", "The Sign of the Four", 1890, "Sign of the Four", false],
  [834, "Arthur Conan Doyle", "The Memoirs of Sherlock Holmes", 1893, "Memoirs of Sherlock", false],
  [108, "Arthur Conan Doyle", "The Return of Sherlock Holmes", 1905, "Return of Sherlock", false],
  [1155, "Agatha Christie", "The Secret Adversary", 1922, "Secret Adversary", false],
  [1184, "Alexandre Dumas", "The Count of Monte Cristo", 1844, "Monte Cristo", false],
  [
    4363,
    "Friedrich Nietzsche",
    "Beyond Good and Evil (Helen Zimmern, trans.)",
    1886,
    "Beyond Good",
    false,
  ],
  [
    3296,
    "Augustine of Hippo",
    "The Confessions of Saint Augustine (Pusey, trans.)",
    400,
    "Confessions",
    false,
  ],
  [1946, "Anonymous", "The Epic of Gilgamesh", -2000, "Gilgamesh", false],
  [521, "Daniel Defoe", "Robinson Crusoe", 1719, "Crusoe", false],
  [370, "Jack London", "The Sea-Wolf", 1904, "Sea", false],
  [1184, "Alexandre Dumas", "The Count of Monte Cristo", 1844, "Monte", false],
  [2814, "James Joyce", "Dubliners", 1914, "Dubliners", false],
  [30254, "Stephen Crane", "The Red Badge of Courage", 1895, "Red Badge", false],
  [73, "Stephen Crane", "The Red Badge of Courage", 1895, "Red Badge", false],
  [1322, "Walt Whitman", "Leaves of Grass", 1855, "Leaves", false],
  [2701, "Herman Melville", "Moby-Dick", 1851, "Moby", false],
  [15, "Herman Melville", "Moby Dick; or The Whale", 1851, "Moby", false],
  [11, "Lewis Carroll", "Alice's Adventures in Wonderland", 1865, "Alice", false],
  [12, "Lewis Carroll", "Through the Looking-Glass", 1871, "Looking", true],
  [514, "Louisa May Alcott", "Little Women", 1868, "Little Women", false],
  [62, "Edgar Rice Burroughs", "A Princess of Mars", 1912, "Princess of Mars", false],
  [78, "Edgar Rice Burroughs", "Tarzan of the Apes", 1912, "Tarzan", false],
  [1837, "George MacDonald", "The Princess and the Goblin", 1872, "Princess and the Goblin", false],
  [289, "Kenneth Grahame", "The Wind in the Willows", 1908, "Willows", false],
  [27827, "Kenneth Grahame", "The Wind in the Willows", 1908, "Willows", false],
  [1112, "Anonymous", "Beowulf (Gummere, trans.)", 1000, "Beowulf", false],
  [9830, "Ryūnosuke Akutagawa", "Rashomon and Other Stories", 1915, "Rashomon", false],
  [4, "Abraham Lincoln", "The Gettysburg Address", 1863, "Gettysburg", false],
];

const HEADING =
  /^((chapter|book|part|stave|letter|section|canto|story|tale)\s+)?(i|1|one|first|the first)\b\.?(\s|$)/i;
const words = (s: string): number => s.split(/\s+/).length;
const clean = (s: string): boolean => !/[_\[\]*]|\d|[“”"‘’']{2}/.test(s) && !/[A-Z]{5,}/.test(s);

function sentences(p: string): string[] {
  return p.split(/(?<=[.!?])\s+(?=[A-Z])/);
}

function pickOpening(paras: string[]): string | null {
  for (let i = 0; i < paras.length; i++) {
    if (!HEADING.test(paras[i] ?? "") || words(paras[i] ?? "") > 14) continue;
    for (let j = i + 1; j < Math.min(i + 4, paras.length); j++) {
      const p = paras[j] ?? "";
      if (HEADING.test(p) && words(p) <= 14) break;
      if (words(p) < 12) continue;
      const ss = sentences(p);
      let text = ss[0] ?? "";
      if (text.length < 40 && ss[1] !== undefined) text = `${text} ${ss[1]}`;
      return text.length >= 25 && text.length <= 320 && clean(text) ? text : null;
    }
  }
  return null;
}

function pickPassage(paras: string[]): string | null {
  for (let i = Math.floor(paras.length / 2); i < paras.length; i++) {
    const p = paras[i] ?? "";
    const ss = sentences(p);
    const text = ss.length > 3 ? ss.slice(0, 2).join(" ") : p;
    if (
      text.length >= 140 &&
      text.length <= 420 &&
      clean(text) &&
      startsWell(text) &&
      !/[“”"]/.test(text)
    )
      return text;
  }
  return null;
}

// Books whose opening the rule found wrongly (a preface, a poem, a table of contents or mid-chapter
// text). Dropping is a judgement call; no text is ever written by hand.
const BAD_OPENING = new Set([
  135, 600, 236, 4300, 2814, 1952, 834, 108, 64317, 2148, 215, 3207, 3600, 2388, 829, 1597, 15,
]);
const startsWell = (t: string): boolean => /^[A-Z“‘"']/.test(t) && !/^[IVXL]+\.\s/.test(t);

const out: Excerpt[] = [];
const seenIds = new Set<number>();
for (const [id, author, work, year, check, passage] of BOOKS) {
  const dup = seenIds.has(id) && !passage;
  if (dup) continue;
  let raw: string;
  try {
    raw = await bookText(id);
  } catch (e) {
    console.log(`SKIP ${String(id)} ${work}: ${String(e)}`);
    continue;
  }
  if (!titleOf(raw).toLowerCase().includes(check.toLowerCase())) {
    console.log(`SKIP ${String(id)} ${work}: header says "${titleOf(raw)}"`);
    continue;
  }
  const paras = bodyOf(raw)
    .split(/\n\s*\n/)
    .map(norm)
    .filter((p) => p !== "");
  const link = `https://www.gutenberg.org/ebooks/${String(id)}`;
  const base = { author, work, year, gutenbergId: id, link };
  if (!seenIds.has(id)) {
    const text = pickOpening(paras);
    if (text === null || BAD_OPENING.has(id) || !startsWell(text))
      console.log(`no opening: ${work}`);
    else out.push({ ...base, text, kind: "opening" });
  }
  if (passage) {
    const text = pickPassage(paras);
    if (text === null) console.log(`no passage: ${work}`);
    else out.push({ ...base, text, kind: "passage" });
  }
  seenIds.add(id);
}
writeFileSync("src/spark/excerpts.ts", excerptsFile(out));
console.log(
  `${String(out.filter((e) => e.kind === "opening").length)} openings, ${String(out.filter((e) => e.kind === "passage").length)} passages`,
);
