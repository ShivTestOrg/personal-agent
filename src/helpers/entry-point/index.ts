import { Logs } from "@ubiquity-dao/ubiquibot-logger";
import { readdir } from "fs/promises";
import { join, extname } from "path";

export type Language = "typescript" | "javascript" | "python";

const COMMON_ENTRY_POINTS = {
  typescript: ["src/index.ts", "src/main.ts", "index.ts", "main.ts"],
  javascript: ["src/index.js", "src/main.js", "index.js", "main.js"],
  python: ["src/main.py", "main.py", "app.py", "__main__.py"],
};

export async function detectLanguage(projectPath: string, logger?: Logs): Promise<Language> {
  try {
    const files = await readdir(projectPath, { recursive: true });

    logger?.info("Detecting language for project:" + projectPath);

    // Check for TypeScript configuration
    if (files.some((file) => file.endsWith("tsconfig.json"))) {
      return "typescript";
    }

    logger?.info("No TypeScript configuration found");

    // Check file extensions
    const extensions = files.map((file) => extname(file));
    if (extensions.includes(".ts")) return "typescript";
    if (extensions.includes(".py")) return "python";

    logger?.info("No TypeScript or Python files found");
    return "javascript"; // Default to JavaScript
  } catch (error) {
    console.error("Error detecting language:", error);
    logger?.error("Error detecting language:" + error);
    return "javascript";
  }
}

export async function findEntryPoint(projectPath: string, logger?: Logs): Promise<string | null> {
  const language = await detectLanguage(projectPath, logger);
  const possibleEntries = COMMON_ENTRY_POINTS[language];

  for (const entry of possibleEntries) {
    try {
      const fullPath = join(projectPath, entry);
      logger?.info("Checking entry point:" + fullPath);
      await readdir(fullPath);
      return fullPath;
    } catch {
      logger?.info("Entry point not found at:" + entry);
      continue;
    }
  }

  return null;
}
