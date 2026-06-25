#!/usr/bin/env node

import { run } from "../src/cli.js";

run(process.argv).catch((error) => {
  const message = error && error.message ? error.message : String(error);
  console.error(`\nQ2B failed: ${message}`);
  if (process.env.Q2B_DEBUG === "1" && error && error.stack) {
    console.error(error.stack);
  }
  process.exitCode = 1;
});
