import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

export default {
  input: "dist/content.js",
  output: {
    file: "dist/content-script.js",
    format: "iife",
    name: "VoiceLiveComment",
  },
  plugins: [resolve({ browser: true }), commonjs()],
};
