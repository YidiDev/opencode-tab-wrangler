import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { configSchema, optionsSchema } from "../src/config";
import { z } from "zod";
import { Host } from "@opencode/plugin/host";

test("CLI-only export and generated options schema", async () => {
  const pkg = await Bun.file("package.json").json();
  expect(pkg.exports).toEqual({ "./tui": "./tui.ts" });
  const schema = await Bun.file("schema.json").json();
  expect(Object.keys(schema.properties).sort()).toEqual(
    Object.keys(configSchema.shape).sort(),
  );
  expect(schema.additionalProperties).toBe(false);
  expect(schema).toEqual({
    ...z.toJSONSchema(optionsSchema),
    title: "OpenCode Tab Wrangler options",
  });
});
test("real host resolver recognizes the local root entrypoint (regression)", () => {
  expect(Host.resolve({ directory: process.cwd() }).tui).toBe(
    new URL("../tui.ts", import.meta.url).href,
  );
  expect(
    Host.resolve({ name: "opencode-tab-wrangler", directory: process.cwd() })
      .tui,
  ).toBe(new URL("../tui.ts", import.meta.url).href);
  expect(Host.resolve({ directory: process.cwd() }).server).toBeUndefined();
});
test("source never calls destructive session/approval APIs or reads host files", async () => {
  for (const path of await readdir("src", { recursive: true })) {
    if (!/\.tsx?$/.test(path)) continue;
    const source = await Bun.file(`src/${path}`).text();
    expect(source).not.toMatch(
      /\.(remove|interrupt|archive|reply|cancel|generate)\(/,
    );
    expect(source).not.toMatch(/\.session\.prompt\(/);
    expect(source).not.toMatch(
      /from ["'](?:node:fs|bun:sqlite)|Bun\.file|process\.env/,
    );
  }
});
test("README configuration examples stay valid", async () => {
  const readme = await Bun.file("README.md").text();
  for (const match of readme.matchAll(/```json\n([\s\S]*?)```/g)) {
    const value = JSON.parse(match[1]);
    if (value.plugins) {
      for (const plugin of value.plugins)
        if (plugin.options)
          expect(() => optionsSchema.parse(plugin.options)).not.toThrow();
    } else expect(() => optionsSchema.parse(value)).not.toThrow();
  }
});
