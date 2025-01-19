import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Tool, ToolResult, FileWriteResult, JSONSchemaDefinition } from "../../types/tool";

interface DiffBlock {
  search: string;
  replace: string;
}

export class WriteFile implements Tool<FileWriteResult> {
  readonly name = "writeFile";
  readonly description = "Write content to a file or apply diff blocks to update existing content. Creates directories if needed.";
  readonly parameters: JSONSchemaDefinition = {
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
      const filePath = args.filename as string;
      const content = args.content as string;

      if (!filePath || !content) {
        throw new Error("Filename and content are required");
      }

      // Resolve path (handles both absolute and relative paths)
      const resolvedPath = resolve(filePath);
      if (!resolvedPath) {
        throw new Error(`Failed to resolve path: ${filePath}`);
      }

      // Create directory if it doesn't exist
      const dir = dirname(resolvedPath);
      mkdirSync(dir, { recursive: true });

      let newContent: string;
      let diffBlocksApplied = 0;

      // Check if content contains diff blocks
      const hasDiffBlocks = content.includes("<<<<<<< SEARCH");
      const isFilePresent = existsSync(resolvedPath);

      if (hasDiffBlocks) {
        if (isFilePresent) {
          // Apply diff blocks to existing file
          const existingContent = readFileSync(resolvedPath, "utf-8");
          const blocks = this._parseDiffBlocks(content);
          if (blocks.length === 0) {
            throw new Error("No valid diff blocks found in content");
          }
          newContent = this._applyDiff(existingContent, blocks);
          diffBlocksApplied = blocks.length;
        } else {
          throw new Error("Cannot apply diff blocks to non-existent file");
        }
      } else {
        // Direct content write - will create new file if doesn't exist
        newContent = content;
      }

      // Write content
      writeFileSync(resolvedPath, newContent, "utf8");

      // Verify the write operation
      const verificationResult = this._verifyWrite(resolvedPath, newContent);
      if (!verificationResult.success || verificationResult.bytesWritten === undefined) {
        throw new Error(`File write verification failed: ${verificationResult.error || "Unknown error"}`);
      }

      const bytesWritten = verificationResult.bytesWritten;

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

  private _verifyWrite(filePath: string, expectedContent: string): { success: boolean; error?: string; bytesWritten?: number } {
    try {
      // Check if file exists
      if (!existsSync(filePath)) {
        return { success: false, error: "File does not exist after write operation" };
      }

      // Read back the written content
      const writtenContent = readFileSync(filePath, "utf-8");

      console.log("Written content:", writtenContent);

      // Check content length
      const expectedBytes = Buffer.from(expectedContent).length;
      const actualBytes = Buffer.from(writtenContent).length;

      if (actualBytes !== expectedBytes) {
        return {
          success: false,
          error: `Content length mismatch - expected ${expectedBytes} bytes but got ${actualBytes} bytes`,
        };
      }

      // Check content equality
      if (writtenContent !== expectedContent) {
        return {
          success: false,
          error: "Written content does not match expected content",
        };
      }

      // All verifications passed
      return {
        success: true,
        bytesWritten: actualBytes,
      };
    } catch (error) {
      return {
        success: false,
        error: `Verification failed with error: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }
}
