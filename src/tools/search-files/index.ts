import { glob } from "glob";
import { readFileSync } from "fs";
import { Tool, ToolResult, JSONSchemaDefinition } from "../../types/tool";

export interface SearchResult {
  matches: Array<{
    file: string;
    line: number;
    content: string;
    context: string[];
  }>;
  totalFiles: number;
  searchPattern: string;
}

export class SearchFiles implements Tool<SearchResult> {
  readonly name = "searchFiles";
  readonly description = "Searches for files and content using glob patterns and regex";
  readonly parameters: JSONSchemaDefinition = {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Regex pattern to search for",
      },
      filePattern: {
        type: "string",
        description: "Optional glob pattern to filter files",
      },
      isCaseSensitive: {
        type: "boolean",
        description: "Whether to perform case-sensitive search",
      },
      contextLines: {
        type: "number",
        description: "Number of context lines to include before and after match",
      },
    },
    required: ["pattern"],
  };

  private _workingDir: string;
  private readonly _contextLines = 2; // Number of lines of context before and after match

  constructor(workingDir: string = process.cwd()) {
    this._workingDir = workingDir;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult<SearchResult>> {
    try {
      const pattern = args.pattern as string;
      if (!pattern) {
        throw new Error("Search pattern is required");
      }

      const filePattern = (args.filePattern as string) || "**/*";
      const isCaseSensitive = args.isCaseSensitive ?? false;
      const contextLines = (args.contextLines as number) ?? this._contextLines;

      // Find all files matching the glob pattern
      const files = await glob(filePattern, {
        cwd: this._workingDir,
        ignore: ["**/node_modules/**", "**/.git/**"],
        nodir: true,
        absolute: true,
      });

      const regex = new RegExp(pattern, isCaseSensitive ? "g" : "gi");
      const matches: SearchResult["matches"] = [];

      // Search through each file
      for (const file of files) {
        try {
          const content = readFileSync(file, "utf8");
          const lines = content.split("\n");

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (regex.test(line)) {
              // Get context lines
              const start = Math.max(0, i - contextLines);
              const end = Math.min(lines.length, i + contextLines + 1);
              const context = lines.slice(start, end);

              matches.push({
                file: file.replace(this._workingDir + "/", ""),
                line: i + 1,
                content: line,
                context,
              });
            }
            regex.lastIndex = 0; // Reset regex state
          }
        } catch (error) {
          console.error(`Error reading file ${file}:`, error);
          // Continue with other files
        }
      }

      return {
        success: true,
        data: {
          matches,
          totalFiles: files.length,
          searchPattern: pattern,
        },
        metadata: {
          timestamp: Date.now(),
          toolName: this.name,
          filePattern,
          contextLines,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
        metadata: {
          timestamp: Date.now(),
          toolName: this.name,
        },
      };
    }
  }
}
