import { readFileSync } from "fs";
import { Tool, ToolResult, FileReadResult } from "../../types/tool";

export class ReadFile implements Tool {
  readonly name = "read-file";
  readonly description = "Reads content from a file at the specified path";

  async execute(path: string): Promise<ToolResult<FileReadResult>> {
    try {
      console.log(`Reading file: ${path}`);
      const content = readFileSync(path, "utf8");

      return {
        success: true,
        data: {
          content,
          path,
        },
        metadata: {
          timestamp: Date.now(),
          toolName: this.name,
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

  async batchRead(paths: string[]): Promise<ToolResult<FileReadResult[]>> {
    try {
      const results = await Promise.all(paths.map((path) => this.execute(path)));
      const successfulReads = results.filter((result) => result.success && result.data).map((result) => result.data as FileReadResult);

      return {
        success: successfulReads.length === paths.length,
        data: successfulReads,
        metadata: {
          timestamp: Date.now(),
          toolName: this.name,
          totalFiles: paths.length,
          successfulReads: successfulReads.length,
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
