import { readFile } from "fs/promises";
import { join } from "path";

export interface TestConfig {
  runner: "jest" | "mocha" | "vitest";
  command: string;
  testPattern: string;
  configFile?: string;
}

export async function detectTestConfiguration(projectPath: string): Promise<TestConfig> {
  try {
    // Read package.json to check test scripts
    const packageJsonPath = join(projectPath, "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf-8"));
    const testScript = packageJson.scripts?.test || "";

    // Check for test runners in dependencies
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    if (allDeps.jest || testScript.includes("jest")) {
      return {
        runner: "jest",
        command: "bun run test",
        testPattern: "**/*.test.{ts,js}",
        configFile: await findConfigFile(projectPath, ["jest.config.js", "jest.config.ts"]),
      };
    }

    if (allDeps.mocha || testScript.includes("mocha")) {
      return {
        runner: "mocha",
        command: testScript || "mocha",
        testPattern: "test/**/*.{ts,js}",
        configFile: await findConfigFile(projectPath, [".mocharc.js", ".mocharc.json"]),
      };
    }

    if (allDeps.vitest || testScript.includes("vitest")) {
      return {
        runner: "vitest",
        command: testScript || "vitest",
        testPattern: "**/*.test.{ts,js}",
        configFile: await findConfigFile(projectPath, ["vitest.config.ts", "vitest.config.js"]),
      };
    }

    // Default to Jest if no specific runner detected
    return {
      runner: "jest",
      command: "jest",
      testPattern: "**/*.test.{ts,js}",
    };
  } catch (error) {
    console.error("Error detecting test configuration:", error);
    // Return default configuration
    return {
      runner: "jest",
      command: "jest",
      testPattern: "**/*.test.{ts,js}",
    };
  }
}

async function findConfigFile(projectPath: string, possibleNames: string[]): Promise<string | undefined> {
  for (const name of possibleNames) {
    try {
      const path = join(projectPath, name);
      await readFile(path);
      return path;
    } catch {
      continue;
    }
  }
  return undefined;
}
