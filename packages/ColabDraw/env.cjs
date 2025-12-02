const dotenv = require("dotenv");
const { readFileSync } = require("fs");
const pkg = require("./package.json");
const parseEnvVariables = (filepath) => {
  let envVars = {};
  try {
    envVars = Object.entries(dotenv.parse(readFileSync(filepath))).reduce(
      (env, [key, value]) => {
        env[key] = value;
        return env;
      },
      {},
    );
  } catch (error) {
    // console.warn(`Failed to read env file at ${filepath}, falling back to process.env`);
    // Fallback to process.env for CI environments
    Object.keys(process.env).forEach((key) => {
      if (
        key.startsWith("VITE_") ||
        key.startsWith("REACT_APP_") ||
        key === "NODE_ENV"
      ) {
        envVars[key] = process.env[key];
      }
    });
  }

  envVars.PKG_NAME = pkg.name;
  envVars.PKG_VERSION = pkg.version;

  return envVars;
};

module.exports = { parseEnvVariables };
