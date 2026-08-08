import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const skillsRoot = path.join(root, "skills");
const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const expectedSkills = [
  "estifanos-sh-convex-auth",
  "estifanos-sh-convex-auth-review",
  "estifanos-sh-convex-auth-setup",
];

function fail(message) {
  throw new Error(`Agent Skills validation failed: ${message}`);
}

function frontmatter(source, file) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/u);
  if (!match) fail(`${file} must start with YAML frontmatter`);

  const fields = new Map();
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) fail(`${file} has invalid frontmatter: ${line}`);
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return fields;
}

function validateLinks(source, directory, file) {
  for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
    const link = match[1];
    if (/^(?:https?:|#|\/)/u.test(link)) continue;
    const target = path.resolve(directory, link);
    if (!existsSync(target)) fail(`${file} references missing file ${link}`);
  }
}

if (!existsSync(skillsRoot)) fail("missing skills directory");

const skillNames = readdirSync(skillsRoot)
  .filter((entry) => statSync(path.join(skillsRoot, entry)).isDirectory())
  .sort();

if (skillNames.join("\n") !== expectedSkills.join("\n")) {
  fail(`expected ${expectedSkills.join(", ")}; found ${skillNames.join(", ")}`);
}

for (const name of skillNames) {
  const directory = path.join(skillsRoot, name);
  const skillFile = path.join(directory, "SKILL.md");
  const metadataFile = path.join(directory, "agents", "openai.yaml");
  if (!existsSync(skillFile)) fail(`${name} is missing SKILL.md`);
  if (!existsSync(metadataFile)) fail(`${name} is missing agents/openai.yaml`);

  const source = readFileSync(skillFile, "utf8");
  const fields = frontmatter(source, path.relative(root, skillFile));
  if ([...fields.keys()].sort((a, b) => a.localeCompare(b)).join(",") !== "description,name") {
    fail(`${name} frontmatter must contain only name and description`);
  }
  if (fields.get("name") !== name) fail(`${name} frontmatter name must match its directory`);
  if (!namePattern.test(name) || name.length > 64) fail(`${name} is not a valid skill name`);

  const description = fields.get("description") ?? "";
  if (description.length === 0 || description.length > 1024) {
    fail(`${name} description must contain 1-1024 characters`);
  }
  if (!/\buse\b/iu.test(description)) fail(`${name} description must say when to use it`);
  if (source.split("\n").length > 500) fail(`${name}/SKILL.md must stay under 500 lines`);
  if (/\bTODO\b|\[TODO/iu.test(source)) fail(`${name}/SKILL.md contains a TODO`);
  validateLinks(source, directory, path.relative(root, skillFile));

  const metadata = readFileSync(metadataFile, "utf8");
  if (!metadata.includes("display_name:") || !metadata.includes("short_description:")) {
    fail(`${name}/agents/openai.yaml is missing interface metadata`);
  }
  if (!metadata.includes(`$${name}`)) {
    fail(`${name}/agents/openai.yaml default_prompt must mention $${name}`);
  }
}

const docsPage = path.join(root, "docs", "src", "content", "ai", "agent-skills", "+page.md");
if (!existsSync(docsPage)) fail("missing Agent Skills documentation page");
const docs = readFileSync(docsPage, "utf8");
for (const name of expectedSkills) {
  if (!docs.includes(name)) fail(`Agent Skills documentation does not mention ${name}`);
}

console.log(`Validated ${skillNames.length} Agent Skills.`);
