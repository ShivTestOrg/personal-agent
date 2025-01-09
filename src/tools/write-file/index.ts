import { readFileSync, writeFileSync } from "node:fs";
import { Tool, ToolResult, FileWriteResult } from "../../types/tool";

interface DiffBlock {
  search: string;
  replace: string;
}

export class WriteFile implements Tool {
  readonly name = "write-file";
  readonly description = "Applies diff blocks to update file content. Requires absolute file paths.";

  private _parseDiffBlocks(diff: string): DiffBlock[] {
    const blocks: DiffBlock[] = [];
    const regex = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;

    let match;
    while ((match = regex.exec(diff)) !== null) {
      blocks.push({
        search: match[1],
        replace: match[2],
      });
    }
    return blocks;
  }

  private _applyDiff(content: string, blocks: DiffBlock[]): string {
    let result = content;
    for (const block of blocks) {
      result = result.replace(block.search, block.replace);
    }
    return result;
  }

  async execute(path: string, diff: string): Promise<ToolResult<FileWriteResult>> {
    try {
      // Validate absolute path
      if (!path.startsWith("/")) {
        throw new Error("File path must be absolute (start with /)");
      }

      // Read existing content
      const content = readFileSync(path, "utf-8");

      // Parse and apply diff blocks
      const blocks = this._parseDiffBlocks(diff);
      const newContent = this._applyDiff(content, blocks);

      // Write updated content
      writeFileSync(path, newContent);
      const bytesWritten = Buffer.from(newContent).length;

      return {
        success: true,
        data: {
          path,
          bytesWritten,
        },
        metadata: {
          timestamp: Date.now(),
          toolName: this.name,
          diffBlocksApplied: blocks.length,
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
