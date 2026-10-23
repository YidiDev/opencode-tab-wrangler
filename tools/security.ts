import { execFileSync } from "node:child_process";
const paths = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const patterns = [
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /AKIA[A-Z0-9]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /sk-(?:proj-)?[A-Za-z0-9_-]{40,}/,
];
let failed = false;
for (const path of new Set(paths)) {
  const file = Bun.file(path);
  if (!(await file.exists())) continue;
  const content = await file.text();
  if (patterns.some((pattern) => pattern.test(content))) {
    console.error(
      `Possible credential in ${path}; remove it and review history. Match contents omitted.`,
    );
    failed = true;
  }
}
if (failed) process.exitCode = 1;
