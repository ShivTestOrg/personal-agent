import { readFile } from "fs/promises";
import { join } from "path";

export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

export async function detectPackageManager(projectPath: string): Promise<PackageManager> {
  try {
    // Check for lock files in priority order
    const files = await Promise.all([
      readFile(join(projectPath, "yarn.lock"))
        .then(() => true)
        .catch(() => false),
      readFile(join(projectPath, "bun.lockdb"))
        .then(() => true)
        .catch(() => false),
      readFile(join(projectPath, "package-lock.json"))
        .then(() => true)
        .catch(() => false),
      readFile(join(projectPath, "pnpm-lock.yaml"))
        .then(() => true)
        .catch(() => false),
    ]);

    if (files[0]) return "yarn";
    if (files[1]) return "bun";
    if (files[2]) return "npm";
    if (files[3]) return "pnpm";

    // Default to npm if no lock file found
    return "npm";
  } catch (error) {
    console.error("Error detecting package manager:", error);
    return "npm";
  }
}

export async function installDependencies(projectPath: string): Promise<string> {
  const packageManager = await detectPackageManager(projectPath);

  const commands = {
    npm: "npm install",
    yarn: "yarn install",
    bun: "bun install",
    pnpm: "pnpm install",
  };

  return commands[packageManager];
}
