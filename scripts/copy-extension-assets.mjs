import { cp, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const projectRoot = pathToFileURL(`${resolve(".")}/`);
const sourceRoot = pathToFileURL(`${resolve("src")}/`);
const distRoot = pathToFileURL(`${resolve("dist")}/`);
const assets = ["manifest.json", "popup.html", "popup.css", "icons"];

await mkdir(distRoot, { recursive: true });

await Promise.all([
  ...assets.map((asset) =>
    cp(new URL(asset, sourceRoot), new URL(asset, distRoot), { recursive: true }),
  ),
  cp(new URL("LICENSE", projectRoot), new URL("LICENSE", distRoot)),
]);
