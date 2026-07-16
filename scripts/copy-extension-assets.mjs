import { cp, mkdir } from "node:fs/promises";

const projectRoot = new URL("../", import.meta.url);
const sourceRoot = new URL("../src/", import.meta.url);
const distRoot = new URL("../dist/", import.meta.url);
const assets = ["manifest.json", "popup.html", "popup.css", "icons"];

await mkdir(distRoot, { recursive: true });

await Promise.all([
  ...assets.map((asset) =>
    cp(new URL(asset, sourceRoot), new URL(asset, distRoot), { recursive: true }),
  ),
  cp(new URL("LICENSE", projectRoot), new URL("LICENSE", distRoot)),
]);
