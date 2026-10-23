import { readdir } from "node:fs/promises";
const source = (await readdir("src", { recursive: true })).filter((name) =>
  /\.tsx?$/.test(name),
);
const lcov = await Bun.file("coverage/lcov.info").text();
let failed = false;
let totalLines = 0,
  hitLines = 0,
  totalFunctions = 0,
  hitFunctions = 0;
for (const name of source) {
  const record = lcov
    .split("end_of_record")
    .find((part) =>
      new RegExp(`SF:.*src/${name.replaceAll(".", "\\.")}(?:\\r?\\n)`).test(
        part,
      ),
    );
  if (!record) {
    console.error(`Missing production coverage: src/${name}`);
    failed = true;
    continue;
  }
  const value = (key: string) =>
    Number(record.match(new RegExp(`^${key}:(\\d+)`, "m"))?.[1] ?? 0);
  const lines = value("LF") ? value("LH") / value("LF") : 1,
    functions = value("FNF") ? value("FNH") / value("FNF") : 1;
  totalLines += value("LF");
  hitLines += value("LH");
  totalFunctions += value("FNF");
  hitFunctions += value("FNH");
  if (lines < 0.8 || functions < 0.75) {
    console.error(
      `Coverage below per-file floor for src/${name}: lines ${(lines * 100).toFixed(1)}%, functions ${(functions * 100).toFixed(1)}%`,
    );
    failed = true;
  }
}
if (
  !totalLines ||
  hitLines / totalLines < 0.85 ||
  !totalFunctions ||
  hitFunctions / totalFunctions < 0.85
) {
  console.error(
    "Production aggregate coverage must be at least 85% lines and functions",
  );
  failed = true;
}
if (failed) process.exitCode = 1;
