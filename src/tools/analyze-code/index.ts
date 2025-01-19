import { Tool, ToolResult, JSONSchemaDefinition } from "../../types/tool";
import { parseSourceCodeForDefinitionsTopLevel } from "../../helpers/tree-sitter";
import * as path from "path";

export interface CodeAnalysisResult {
  definitions: string;
  path: string;
}

export class AnalyzeCode implements Tool<CodeAnalysisResult> {
  readonly name = "analyzeCode";
  readonly description = "Analyze source code to extract definitions using tree-sitter";
  readonly parameters: JSONSchemaDefinition = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file or directory to analyze",
      },
    },
    required: ["path"],
  };
  private workingDir: string;

  constructor(workingDir: string = process.cwd()) {
    this.workingDir = workingDir;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult<CodeAnalysisResult>> {
    try {
      if (!args.path) {
        throw new Error("Path is required");
      }

      const targetPath = path.resolve(this.workingDir, args.path as string);
      const definitions = await parseSourceCodeForDefinitionsTopLevel(targetPath);

      return {
        success: true,
        data: {
          definitions,
          path: targetPath,
        },
        metadata: {
          timestamp: Date.now(),
          toolName: this.name,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          timestamp: Date.now(),
          toolName: this.name,
        },
      };
    }
  }
}
