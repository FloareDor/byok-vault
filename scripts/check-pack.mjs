import { execFileSync } from "node:child_process";

function runNpm(args) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    return execFileSync(process.execPath, [npmExecPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"]
    });
  }

  return execFileSync("npm", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"]
  });
}

function runPackDryRun() {
  const stdout = runNpm(["pack", "--json", "--dry-run"]);

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`Unable to parse npm pack --json output:\n${stdout}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("npm pack --json returned no package metadata.");
  }

  return parsed[0];
}

function assertPackShape(entry) {
  if (!entry || !Array.isArray(entry.files)) {
    throw new Error("npm pack metadata is missing the files list.");
  }
}

function main() {
  const packEntry = runPackDryRun();
  assertPackShape(packEntry);

  const paths = packEntry.files.map((file) => String(file.path));
  const pathSet = new Set(paths);

  const requiredFiles = [
    "package.json",
    "README.md",
    "dist/index.js",
    "dist/index.d.ts"
  ];

  const forbiddenPrefixes = ["src/", "test/", "demo/", "agent-context/", "node_modules/"];

  const missing = requiredFiles.filter((path) => !pathSet.has(path));
  const forbidden = paths.filter((path) =>
    forbiddenPrefixes.some((prefix) => path.startsWith(prefix))
  );

  if (missing.length > 0 || forbidden.length > 0) {
    const errors = [];
    if (missing.length > 0) {
      errors.push(`Missing required files: ${missing.join(", ")}`);
    }
    if (forbidden.length > 0) {
      errors.push(`Forbidden files found: ${forbidden.join(", ")}`);
    }
    throw new Error(errors.join("\n"));
  }

  console.log(
    `Pack check passed (${paths.length} files). Tarball: ${packEntry.filename ?? "unknown"}`
  );
}

main();
