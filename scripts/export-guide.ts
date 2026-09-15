import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { russianGuideMarkdown } from "../apps/client/src/guide.ts";

const output = resolve(process.argv[2] ?? "docs/user-guide.ru.md");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, russianGuideMarkdown());
console.log(output);
