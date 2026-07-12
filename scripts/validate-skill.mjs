import fs from "node:fs";
import path from "node:path";

const skillPath = path.resolve("skills/on-call-autopilot-implementation/SKILL.md");
const source = fs.readFileSync(skillPath, "utf8");
if (!source.startsWith("---\n")) throw new Error("frontmatter must start at byte 0");
const end = source.indexOf("\n---\n", 4);
if (end < 0) throw new Error("frontmatter not closed");
const frontmatter = source.slice(4, end);
const field = (key) => frontmatter.match(new RegExp(`^${key}:\\s*["']?([^\\n"']+)`, "m"))?.[1]?.trim();
const name = field("name");
const description = field("description");
if (!name || !description) throw new Error("name and description required");
if (name.length > 64 || !/^[a-z0-9-]+$/.test(name)) throw new Error("invalid name");
if (description.length > 1024) throw new Error("description too long");
if (!source.slice(end + 5).trim()) throw new Error("body required");
if (source.length > 100_000) throw new Error("skill too large");
console.log(`valid skill: ${name} (${source.length} chars)`);
