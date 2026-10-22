import { z } from "zod";
import { optionsSchema } from "../src/config";
import { format } from "prettier";
const content = await format(
  JSON.stringify({
    ...z.toJSONSchema(optionsSchema),
    title: "OpenCode Tab Wrangler options",
  }),
  { parser: "json" },
);
if (process.argv.includes("--check")) {
  if ((await Bun.file("schema.json").text()) !== content) {
    console.error("schema.json is stale; run bun run schema");
    process.exitCode = 1;
  }
} else await Bun.write("schema.json", content);
