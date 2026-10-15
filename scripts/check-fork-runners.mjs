import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const directory = process.argv[2] ?? ".github/workflows";
const violations = [];
for (const file of readdirSync(directory).filter((name) =>
  /\.ya?ml$/.test(name),
)) {
  const lines = readFileSync(join(directory, file), "utf8").split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.trimStart().startsWith("#")) continue;
    if (/\bblacksmith-[\w-]+\b/i.test(line.split("#")[0])) {
      violations.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  }
}
if (violations.length > 0) {
  console.error(
    "Use GitHub-hosted runners in this fork:\n" + violations.join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log("Fork workflows use no Blacksmith runners.");
}
