import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Tool, ToolResult, FileWriteResult, FunctionParameters } from "../../types/tool";

interface DiffBlock {
  search: string;
  replace: string;
}

export class WriteFile implements Tool<FileWriteResult> {
  readonly name = "writeFile";
  readonly description = "Write content to a file or apply diff blocks to update existing content. Creates directories if needed.";
  readonly parameters: FunctionParameters = {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description: "Path to the file (absolute or relative)",
      },
      content: {
        type: "string",
        description: "Content to write directly, or diff blocks in format: <<<<<<< SEARCH\n[existing content]\n=======\n[new content]\n>>>>>>> REPLACE",
      },
    },
    required: ["filename", "content"],
  };

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

  async execute(args: Record<string, unknown>): Promise<ToolResult<FileWriteResult>> {
    try {
      const path = args.filename as string;
      const diff = args.content as string;

      if (!path || !diff) {
        throw new Error("Filename and content are required");
      }

      // Resolve path (handles both absolute and relative paths)
      const resolvedPath = resolve(path);

      // Create directory if it doesn't exist
      const dir = dirname(resolvedPath);
      mkdirSync(dir, { recursive: true });

      let newContent: string;
      let diffBlocksApplied = 0;

      // Check if content contains diff blocks
      const hasDiffBlocks = diff.includes("<<<<<<< SEARCH");
      const isFilePresent = existsSync(resolvedPath);

      if (hasDiffBlocks) {
        if (isFilePresent) {
          // Apply diff blocks to existing file
          const content = readFileSync(resolvedPath, "utf-8");
          const blocks = this._parseDiffBlocks(diff);
          newContent = this._applyDiff(content, blocks);
          diffBlocksApplied = blocks.length;
        } else {
          throw new Error("Cannot apply diff blocks to non-existent file");
        }
      } else {
        // Direct content write - will create new file if doesn't exist
        newContent = diff;
      }

      // Write content
      writeFileSync(resolvedPath, newContent);
      const bytesWritten = Buffer.from(newContent).length;

      return {
        success: true,
        data: {
          path: resolvedPath,
          bytesWritten,
          diffBlocksApplied,
        },
        metadata: {
          timestamp: Date.now(),
          toolName: this.name,
          diffBlocksApplied,
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
