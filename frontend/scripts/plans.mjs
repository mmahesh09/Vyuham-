// Copies the plan config (backend/app/plans.json, the single source) into the web app.
// Run after changing plans.json: npm run plans:sync. A backend test fails if the copy is stale.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../../backend/app/plans.json");
const target = resolve(here, "../src/config/plans.generated.json");

const config = JSON.parse(readFileSync(source, "utf8"));
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(config, null, 2) + "\n");
console.log(`plans: ${config.plans.length} plans copied to src/config/plans.generated.json`);
