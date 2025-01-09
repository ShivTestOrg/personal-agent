import OpenAI from "openai";
import { Context } from "../../../types/context";
import { SuperOpenAi } from "./openai";
import { Tool, ToolResult, ToolResultMap, DirectoryExploreResult } from "../../../types/tool";
import { ReadFile } from "../../../tools/read-file";
import { WriteFile } from "../../../tools/write-file";
import { ExploreDir } from "../../../tools/explore-dir";
import { SearchFiles } from "../../../tools/search-files";
import { CreatePr } from "../../../tools/create-pr";

const MAX_TRIES = 5;

const sysMsg = `You are a capable AI assistant currently running on a GitHub bot. 
You are designed to assist with resolving issues by making incremental fixes using a standardized tool interface.
Each tool implements a common interface that provides consistent error handling and result reporting.

Workflow:
1. The repository has already been cloned and you are in the correct working directory
2. The end goal is solve the issue by making the changes, once the issue is resolved, this would be converted into a pull request.
3. After each attempt to solve the issue by using an appropriate tool, you will receive feedback, if the attempt was successful or not for example if you want to make change to file you would use the writeFile tool to make the change, this is just an example.
4. If not complete, you will continue with additional attempts up to ${MAX_TRIES} tries
5. Each attempt should build upon previous attempts, learning from any failures

To use tools, you can include one or more tool requests in your response. Each tool request should be formatted like this:
\`\`\`tool
{
  "tool": "readFile|writeFile|exploreDir|searchFiles",
  "args": {
    // For readFile:
    "filename": "/absolute/path/to/file"
    
    // For writeFile:
    "filename": "/absolute/path/to/file",
    "content": "diff blocks in format:
    <<<<<<< SEARCH
    [existing content to find]
    =======
    [new content to replace with]
    >>>>>>> REPLACE"
        
    // For exploreDir:
    "command": "tree"

    // For searchFiles:
    "pattern": "regex pattern",
    "filePattern": "glob pattern (optional)",
    "caseSensitive": boolean (optional),
    "contextLines": number (optional)
  }
}
\`\`\`

Multiple tool requests will be processed sequentially in the order they appear in your response. Each tool request will be replaced with its corresponding result.

The tool will execute and return a result in this format:
\`\`\`result
{
  "success": true|false,
  "data": {
    // Tool-specific result data
  },
  "error": "error message if failed",
  "metadata": {
    "timestamp": number,
    "toolName": string
  }
}
\`\`\`

Available Tools:

### ReadFile Tool ###
- Purpose: Read file contents
- Method: execute(filename: string)
- Returns: ToolResult<FileReadResult> containing:
  - success: boolean
  - data: { content: string, path: string }
  - error?: string
  - metadata: execution details

### WriteFile Tool ###
- Purpose: Update file contents using diff blocks
- Method: execute(path: string, diff: string)
- Requires absolute file paths (must start with '/')
- Diff format:

  <<<<<<< SEARCH
  [existing content to find]
  =======
  [new content to replace with]
  >>>>>>> REPLACE

- Returns: ToolResult<FileWriteResult> containing:
  - success: boolean
  - data: { path: string, bytesWritten: number, diffBlocksApplied: number }
  - error?: string
  - metadata: execution details

### ExploreDir Tool ###
- Purpose: Directory operations
- Method: execute(command: 'tree', args?: any)
- Returns: ToolResult<DirectoryExploreResult> containing:
  - success: boolean
  - data: { currentPath: string, tree?: string }
  - error?: string
  - metadata: execution details

### SearchFiles Tool ###
- Purpose: Search files using regex patterns
- Method: execute(pattern: string, options?: { filePattern?: string, caseSensitive?: boolean, contextLines?: number })
- Returns: ToolResult<SearchResult> containing:
  - success: boolean
  - data: { 
    matches: Array<{ file: string, line: number, content: string, context: string[] }>,
    totalFiles: number,
    searchPattern: string
  }
  - error?: string
  - metadata: execution details

Note: All file paths must be absolute paths. For example, if you want to write to "src/file.ts", you must specify the full path starting with "/". Relative paths are not supported.

Rules and Best Practices:
1. Always check ToolResult.success before using the data
2. Handle errors gracefully using the provided error information
3. Use metadata for logging and debugging purposes
4. Follow existing code style and conventions
5. Document significant changes
6. Consider edge cases and error handling
7. After each attempt, evaluate if the solution is complete
8. You have up to ${MAX_TRIES} attempts to complete each task`;

interface ToolSet {
  readFile: ReadFile;
  writeFile: WriteFile;
  exploreDir: ExploreDir;
  searchFiles: SearchFiles;
  createPr: CreatePr;
}

type ToolName = keyof ToolResultMap;

interface ToolRequest {
  tool: ToolName;
  args: {
    filename?: string;
    content?: string;
    command?: "tree";
    pattern?: string;
    filePattern?: string;
    caseSensitive?: boolean;
    contextLines?: number;
  };
}

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export class Completions extends SuperOpenAi {
  protected maxTokens: number;
  protected tools: ToolSet;
  protected llmAttempts: number;
  protected toolAttempts: number;

  constructor(client: OpenAI, context: Context) {
    super(client, context);
    this.maxTokens = 100000;
    this.llmAttempts = 0;
    this.toolAttempts = 0;
    this.tools = {
      readFile: new ReadFile(),
      writeFile: new WriteFile(),
      exploreDir: new ExploreDir(),
      searchFiles: new SearchFiles(),
      createPr: new CreatePr(context),
    };
  }

  private async _executeToolRequest(request: ToolRequest, workingDir: string): Promise<ToolResult<ToolResultMap[ToolName]>> {
    this.context.logger.info(`Executing tool request: ${request.tool} with args:`, request.args);
    try {
      switch (request.tool) {
        case "readFile":
          if (!request.args.filename) throw new Error("Filename is required for readFile");
          return this._readFile(request.args.filename, workingDir);

        case "writeFile":
          if (!request.args.filename || !request.args.content) {
            throw new Error("Filename and content are required for writeFile");
          }
          return this._writeFile(request.args.filename, request.args.content, workingDir);

        case "exploreDir":
          return this._getDirectoryTree(workingDir);

        case "searchFiles":
          if (!request.args.pattern) throw new Error("Search pattern is required");
          return this._searchFiles(request.args.pattern, workingDir, {
            filePattern: request.args.filePattern,
            caseSensitive: request.args.caseSensitive,
            contextLines: request.args.contextLines,
          });

        default:
          throw new Error(`Unknown tool: ${request.tool}`);
      }
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      this.context.logger.error(`Tool execution failed:`, { error: errorObj });
      throw error;
    }
  }

  private async _processResponse(response: string, workingDir: string): Promise<string> {
    // Find all tool blocks in the response
    const toolBlocks = [...response.matchAll(/```tool\n([\s\S]*?)```/g)];
    if (toolBlocks.length === 0) return response;

    let processedResponse = response;

    // Process each tool request sequentially
    for (const toolBlock of toolBlocks) {
      const fullMatch = toolBlock[0];
      const toolJson = toolBlock[1];

      try {
        const toolRequest: ToolRequest = JSON.parse(toolJson);

        // For writeFile, ensure content is stringified if it's an object
        if (toolRequest.tool === "writeFile" && toolRequest.args.content && typeof toolRequest.args.content === "object") {
          toolRequest.args.content = JSON.stringify(toolRequest.args.content, null, 2);
        }

        const result = await this._executeToolRequest(toolRequest, workingDir);

        // Replace this specific tool block with its result
        processedResponse = processedResponse.replace(fullMatch, "```result\n" + JSON.stringify(result, null, 2) + "\n```");
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        this.context.logger.error(`Failed to process tool request:`, { error: errorObj });

        // Replace this specific tool block with its error
        processedResponse = processedResponse.replace(
          fullMatch,
          "```result\n" +
            JSON.stringify(
              {
                success: false,
                error: errorObj.message,
              },
              null,
              2
            ) +
            "\n```"
        );
      }
    }

    return processedResponse;
  }

  private async _checkSolution(prompt: string, model: string): Promise<boolean> {
    const res = await this.client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a solution validator. Respond with 'SOLVED' if the issue is completely resolved, or 'CONTINUE' if more work is needed. Provide a brief explanation after your decision.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.2,
      max_tokens: 50,
    });

    const response = res.choices[0]?.message?.content || "";
    return response.includes("SOLVED");
  }

  private async _executeWithRetry<T extends ToolName>(
    tool: Tool<ToolResultMap[T]>,
    method: string,
    workingDir: string,
    ...args: unknown[]
  ): Promise<ToolResult<ToolResultMap[T]>> {
    this.toolAttempts++;

    if (this.toolAttempts > MAX_TRIES) {
      const error = new Error(`Maximum attempts (${MAX_TRIES}) exceeded`);
      this.context.logger.error(`Tool retry limit exceeded:`, { error });
      return {
        success: false,
        error: error.message,
        metadata: {
          timestamp: Date.now(),
          toolName: tool.name,
          toolAttempts: this.toolAttempts,
          workingDir,
        },
      };
    }

    try {
      const result = await tool.execute(...args);

      if (!result.success && this.toolAttempts < MAX_TRIES) {
        const error = new Error(result.error || "Unknown error");
        this.context.logger.error(`Tool attempt ${this.toolAttempts} failed:`, { error });
        return this._executeWithRetry(tool, method, workingDir, ...args);
      }

      if (result.success) {
        this.context.logger.info(`Tool execution successful:`, {
          toolName: tool.name,
          data: result.data,
          metadata: result.metadata,
        });
      }

      return result;
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      this.context.logger.error(`Tool attempt ${this.toolAttempts} error:`, { error: errorObj });

      if (this.toolAttempts < MAX_TRIES) {
        return this._executeWithRetry(tool, method, workingDir, ...args);
      }

      return {
        success: false,
        error: errorObj.message,
        metadata: {
          timestamp: Date.now(),
          toolName: tool.name,
          toolAttempts: this.toolAttempts,
          workingDir,
        },
      };
    }
  }

  async createCompletion(prompt: string, model: string, workingDir: string, currentSolution: string = "") {
    // Reset attempts counter for new completion
    this.llmAttempts = 0;
    this.toolAttempts = 0;

    // Update tools with working directory
    this.tools.exploreDir = new ExploreDir(workingDir);
    this.tools.searchFiles = new SearchFiles(workingDir);

    let isSolved = false;
    let finalResponse: OpenAI.Chat.Completions.ChatCompletion | null = null;
    const conversationHistory: ChatMessage[] = [
      {
        role: "system",
        content: sysMsg,
      },
    ];

    while (this.llmAttempts < MAX_TRIES && !isSolved) {
      // Get the directory tree
      const treeResult = await this._getDirectoryTree(workingDir);
      const treeOutput =
        treeResult.success && (treeResult.data as DirectoryExploreResult)?.tree
          ? (treeResult.data as DirectoryExploreResult).tree
          : "Unable to get directory tree";

      this.context.logger.info("Directory tree:", { tree: treeOutput });

      // Add the current state to conversation
      conversationHistory.push({
        role: "user",
        content: `Current LLM attempt: ${this.llmAttempts + 1}/${MAX_TRIES}\nWorking directory: ${workingDir}\n\nDirectory structure:\n${treeOutput}\n\nPrevious solution state: ${currentSolution}\n\nOriginal request: ${prompt}`,
      });

      const res = await this.client.chat.completions.create({
        model,
        messages: conversationHistory,
        temperature: 0.2,
        max_tokens: this.maxTokens,
        top_p: 0.5,
        frequency_penalty: 0,
        presence_penalty: 0,
      });

      this.context.logger.info("LLM response:", { response: res });
      finalResponse = res;

      // Get the LLM's response
      const llmResponse = res.choices[0]?.message?.content || "";

      // Process any tool requests in the response
      const processedResponse = await this._processResponse(llmResponse, workingDir);

      // Add the processed response to conversation history
      conversationHistory.push({
        role: "assistant",
        content: processedResponse,
      });

      // Update current solution state
      currentSolution = processedResponse;

      // Check if the solution is complete
      isSolved = await this._checkSolution(currentSolution, model);

      if (!isSolved) {
        this.llmAttempts++;
        this.context.logger.info(`Solution incomplete, attempt ${this.llmAttempts}/${MAX_TRIES}`);
      }
    }

    if (isSolved) {
      // Create a pull request with the changes
      const prTitle = `Fix: ${prompt.split("\n")[0]}`; // Use first line of prompt as PR title
      const prBody = `This PR addresses the following:

${prompt}

Changes made:
${currentSolution}`;

      const prResult = await this._createPullRequest(prTitle, prBody);
      if (prResult.success) {
        this.context.logger.info("Created pull request:", {
          data: prResult.data,
          metadata: prResult.metadata,
        });
      } else {
        this.context.logger.error("Failed to create pull request:", {
          error: new Error(prResult.error || "Unknown error"),
          metadata: prResult.metadata,
        });
      }
    }

    return finalResponse;
  }

  private async _createPullRequest(title: string, body: string) {
    return this._executeWithRetry(this.tools.createPr, "execute", "", title, body);
  }

  // Helper methods to execute tools with retry logic
  private async _readFile(filename: string, workingDir: string) {
    return this._executeWithRetry(this.tools.readFile, "execute", workingDir, filename);
  }

  private async _writeFile(filename: string, content: string, workingDir: string) {
    return this._executeWithRetry(this.tools.writeFile, "execute", workingDir, filename, content);
  }

  private async _getDirectoryTree(workingDir: string) {
    return this._executeWithRetry(this.tools.exploreDir, "execute", workingDir, "tree");
  }

  private async _searchFiles(
    pattern: string,
    workingDir: string,
    options?: {
      filePattern?: string;
      caseSensitive?: boolean;
      contextLines?: number;
    }
  ) {
    return this._executeWithRetry(this.tools.searchFiles, "execute", workingDir, pattern, options);
  }
}
