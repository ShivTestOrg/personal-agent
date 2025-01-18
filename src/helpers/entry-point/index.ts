import { readdir } from "fs/promises";
import { join, extname } from "path";

export type Language = "typescript" | "javascript" | "python";

const COMMON_ENTRY_POINTS = {
  typescript: ["src/index.ts", "src/main.ts", "index.ts", "main.ts"],
  javascript: ["src/index.js", "src/main.js", "index.js", "main.js"],
  python: ["src/main.py", "main.py", "app.py", "__main__.py"],
};

export async function detectLanguage(projectPath: string): Promise<Language> {
  try {
    const files = await readdir(projectPath, { recursive: true });

    // Check for TypeScript configuration
    if (files.some((file) => file.endsWith("tsconfig.json"))) {
      return "typescript";
    }

    // Check file extensions
    const extensions = files.map((file) => extname(file));
    if (extensions.includes(".ts")) return "typescript";
    if (extensions.includes(".py")) return "python";

    return "javascript"; // Default to JavaScript
  } catch (error) {
    console.error("Error detecting language:", error);
    return "javascript";
  }
}

export async function findEntryPoint(projectPath: string): Promise<string | null> {
  const language = await detectLanguage(projectPath);
  const possibleEntries = COMMON_ENTRY_POINTS[language];

  for (const entry of possibleEntries) {
    try {
      const fullPath = join(projectPath, entry);
      await readdir(fullPath);
      return fullPath;
    } catch {
      continue;
    }
  }

  return null;
}
