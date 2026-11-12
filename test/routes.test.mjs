// quality/pages.json lists the pages every gate checks. It must equal the route table of src/routes.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { routes } from "../src/routes.ts";

test("quality/pages.json equals the file and path of every route in src/routes.ts", () => {
  const pages = JSON.parse(readFileSync(new URL("../quality/pages.json", import.meta.url), "utf8"));
  assert.deepEqual(pages, routes.map((r) => ({ file: r.file, path: r.path })));
});
