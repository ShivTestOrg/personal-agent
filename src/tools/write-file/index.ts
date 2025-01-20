import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Tool, ToolResult, FileWriteResult, JSONSchemaDefinition } from "../../types/tool";
import { Context } from "../../types/context";

interface DiffBlock {
  search: string;
  replace: string;
}

export class WriteFile implements Tool<FileWriteResult> {
  readonly name = "writeFile";
  readonly description = "Write content to a file or apply diff blocks to update existing content. Creates directories if needed.";
  private context: Context;

  constructor(context: Context) {
    this.context = context;
  }

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

  private _validateDiffBlock(block: string): { isValid: boolean; error?: string } {
    if (!block.includes("<<<<<<< SEARCH")) {
      return { isValid: false, error: "Missing SEARCH marker" };
    }
    if (!block.includes("=======")) {
      return { isValid: false, error: "Missing separator marker" };
    }
    if (!block.includes(">>>>>>> REPLACE")) {
      return { isValid: false, error: "Missing REPLACE marker" };
    }

    // Check for proper ordering of markers
    const searchIndex = block.indexOf("<<<<<<< SEARCH");
    const separatorIndex = block.indexOf("=======");
    const replaceIndex = block.indexOf(">>>>>>> REPLACE");

    if (!(searchIndex < separatorIndex && separatorIndex < replaceIndex)) {
      return { isValid: false, error: "Invalid diff block structure - markers are in wrong order" };
    }

    return { isValid: true };
  }

  private _parseDiffBlocks(diff: string): DiffBlock[] {
    const blocks: DiffBlock[] = [];
    const regex = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;

    // First validate the overall structure
    const validation = this._validateDiffBlock(diff);
    if (!validation.isValid) {
      this.context.logger.error("Diff block validation failed:", { error: validation.error ? { stack: validation.error } : undefined });
      throw new Error(`Invalid diff block format: ${validation.error}`);
    }

    let match;
    while ((match = regex.exec(diff)) !== null) {
      const searchContent = match[1];
      const replaceContent = match[2];

      // Additional validation for search/replace content
      if (!searchContent.trim()) {
        this.context.logger.error("Empty SEARCH block found");
        throw new Error("SEARCH block cannot be empty");
      }

      blocks.push({
        search: searchContent,
        replace: replaceContent,
      });
    }

    if (blocks.length === 0) {
      this.context.logger.error("No valid diff blocks found in content");
      throw new Error("No valid diff blocks found in content");
    }

    this.context.logger.info(`Successfully parsed ${blocks.length} diff blocks`);
    return blocks;
  }

  private _applyDiff(content: string, blocks: DiffBlock[]): string {
    let result = content;
    let appliedBlocks = 0;

    for (const block of blocks) {
      const beforeReplace = result;
      result = result.replace(block.search, block.replace);

      // Verify if replacement occurred
      if (result === beforeReplace) {
        this.context.logger.error("Search block not found in content:", { search: block.search });
        throw new Error("Failed to apply diff: search content not found in file");
      }
      appliedBlocks++;
    }

    this.context.logger.info(`Successfully applied ${appliedBlocks} diff blocks`);
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

      this.context.logger.info(`Writing to file:`, { path: resolvedPath });

      // Create directory if it doesn't exist
      const dir = dirname(resolvedPath);
      mkdirSync(dir, { recursive: true });

      let newContent: string;
      let diffBlocksApplied = 0;

      // Check if content contains diff blocks
      const hasDiffBlocks = content.includes("<<<<<<< SEARCH");
      const isFilePresent = existsSync(resolvedPath);

      if (hasDiffBlocks) {
        this.context.logger.info("Detected diff blocks in content");

        if (!isFilePresent) {
          this.context.logger.error(`Cannot apply diff blocks to non-existent file:`, { path: resolvedPath });
          throw new Error("Cannot apply diff blocks to non-existent file");
        }

        try {
          // Apply diff blocks to existing file
          const existingContent = readFileSync(resolvedPath, "utf-8");
          this.context.logger.info(`Read existing file content from:`, { path: resolvedPath });

          const blocks = this._parseDiffBlocks(content);
          if (blocks.length === 0) {
            this.context.logger.error("No valid diff blocks found in content");
            throw new Error("No valid diff blocks found in content");
          }

          newContent = this._applyDiff(existingContent, blocks);
          diffBlocksApplied = blocks.length;
          this.context.logger.info(`Successfully applied ${diffBlocksApplied} diff blocks to file`);
        } catch (error) {
          this.context.logger.error("Error applying diff blocks:", {
            error: error instanceof Error ? error : { stack: String(error) },
            stack: error instanceof Error ? error.stack : undefined,
          });
          const typedError = error instanceof Error ? error : new Error(String(error || "Unknown error"));
          throw typedError;
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

      this.context.logger.info(`Successfully wrote file:`, {
        path: resolvedPath,
        bytesWritten,
        diffBlocksApplied,
      });

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
      const errorObj = error instanceof Error ? error : new Error(String(error || "Unknown error"));
      this.context.logger.error(`File write failed:`, {
        error: { stack: errorObj.message },
        stack: errorObj.stack,
      });

      return {
        success: false,
        error: errorObj.message || "Unknown error occurred",
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

      this.context.logger.debug("Written content:", { content: writtenContent });

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
