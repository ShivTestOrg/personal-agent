import { writeFileSync } from "node:fs";
import { Tool, ToolResult, FileWriteResult } from "../../types/tool";

export class WriteFile implements Tool {
  readonly name = "write-file";
  readonly description = "Writes content to a file at the specified path";

  async execute(path: string, data: string): Promise<ToolResult<FileWriteResult>> {
    try {
      writeFileSync(path, data);
      const bytesWritten = Buffer.from(data).length;

      return {
        success: true,
        data: {
          path,
          bytesWritten,
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
}
