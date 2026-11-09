// After `npx shadcn add`, map shadcn's surface tokens onto the brand palette in vendored files.
// Brand --muted / --accent are TEXT colours (globals.css), so bg-muted / bg-accent would paint
// lavender / pink panels. Run: npm run ui:tokens
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BRAND_FILES = new Set(["core.tsx", "dotted-map.tsx", "finance-bento.tsx", "mark.tsx", "particles.tsx", "simple-popover.tsx"]);
const ROOTS = ["src/components/ui", "src/components/reui", "src/components/examples"];
const RULES = [
  [/(?<![\w-])(bg|from|via|to|ring-offset|outline|fill|stroke|divide|border)-muted(?![\w-])/g, "$1-surface-2"],
  [/(?<![\w-])(bg|from|via|to|fill|stroke)-accent(?![\w-])/g, "$1-surface-2"],
  [/(?<![\w-])border-accent(?![\w-])/g, "border-line"],
  [/(?<![\w-])text-accent-foreground(?![\w-])/g, "text-text"],
];

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
  });

let files = 0;
for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (root.endsWith("/ui") && BRAND_FILES.has(file.split(/[\/]/).pop())) continue;
    const before = readFileSync(file, "utf8");
    let after = before;
    for (const [re, rep] of RULES) after = after.replace(re, rep);
    if (after !== before) {
      writeFileSync(file, after);
      files++;
    }
  }
}
console.log(`brand-tokens: updated ${files} file(s)`);
