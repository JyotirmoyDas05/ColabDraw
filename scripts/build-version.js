#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const versionFile = path.join("build", "version.json");
const indexFile = path.join("build", "index.html");

const versionDate = (date) => date.toISOString().replace(".000", "");

const commitHash = () => {
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 8);
  }
  if (
    process.env.VITE_APP_GIT_SHA &&
    process.env.VITE_APP_GIT_SHA !== "$VERCEL_GIT_COMMIT_SHA"
  ) {
    return process.env.VITE_APP_GIT_SHA.slice(0, 8);
  }
  try {
    return require("child_process")
      .execSync("git rev-parse --short HEAD")
      .toString()
      .trim();
  } catch {
    return "none";
  }
};

const commitDate = (hash) => {
  try {
    const unix = require("child_process")
      .execSync(`git show -s --format=%ct ${hash}`)
      .toString()
      .trim();
    const date = new Date(parseInt(unix, 10) * 1000);
    return versionDate(date);
  } catch {
    return versionDate(new Date());
  }
};

const getFullVersion = () => {
  const hash = commitHash();
  return `${commitDate(hash)}-${hash}`;
};

const rawSha =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  (process.env.VITE_APP_GIT_SHA &&
  process.env.VITE_APP_GIT_SHA !== "$VERCEL_GIT_COMMIT_SHA"
    ? process.env.VITE_APP_GIT_SHA
    : "") ||
  commitHash();

const data = JSON.stringify(
  {
    version: getFullVersion(),
    gitSha: commitHash(),
    fullSha: rawSha,
    buildTime: Date.now(),
  },
  undefined,
  2,
);

fs.writeFileSync(versionFile, data);

// https://stackoverflow.com/a/14181136/8418
if (fs.existsSync(indexFile)) {
  fs.readFile(indexFile, "utf8", (error, fileData) => {
    if (error) {
      return console.error(error);
    }
    const result = fileData.replace(/{version}/g, getFullVersion());

    fs.writeFile(indexFile, result, "utf8", (err) => {
      if (err) {
        return console.error(err);
      }
    });
  });
}
