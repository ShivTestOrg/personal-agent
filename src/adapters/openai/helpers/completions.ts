import OpenAI from "openai";
import { Context } from "../../../types/context";
import { SuperOpenAi } from "./openai";
import { Tool, ToolResult, ToolResultMap } from "../../../types/tool";
import { ReadFile } from "../../../tools/read-file";
import { WriteFile } from "../../../tools/write-file";
import { ExploreDir } from "../../../tools/explore-dir";

const MAX_TRIES = 5;

const sysMsg = `You are a capable AI assistant currently running on a GitHub bot. 
You are designed to assist with resolving issues by making incremental fixes using a standardized tool interface.
Each tool implements a common interface that provides consistent error handling and result reporting.

Workflow:
1. The repository has already been cloned and you are in the correct working directory
2. After each attempt to solve the issue, you will be asked if the solution is complete
3. If not complete, you will continue with additional attempts up to ${MAX_TRIES} tries
4. Each attempt should build upon previous attempts, learning from any failures

To use a tool, format your response like this:
\`\`\`tool
{
  "tool": "readFile|writeFile|exploreDir",
  "args": {
    // For readFile:
    "filename": "path/to/file"
    
    // For writeFile:
    "filename": "path/to/file",
    "content": "file content"
    
    // For exploreDir:
    "command": "tree"
  }
}
\`\`\`

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
- Purpose: Write/update file contents
- Method: execute(filename: string, content: string)
- Returns: ToolResult<FileWriteResult> containing:
  - success: boolean
  - data: { path: string, bytesWritten: number }
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

Note: All file paths are relative to the current working directory. You only need to provide filenames.

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
}

type ToolName = keyof ToolResultMap;

interface ToolRequest {
  tool: ToolName;
  args: {
    filename?: string;
    content?: string;
    command?: "tree";
  };
}

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export class Completions extends SuperOpenAi {
  protected maxTokens: number;
  protected tools: ToolSet;
  protected attempts: number;

  constructor(client: OpenAI, context: Context) {
    super(client, context);
    this.maxTokens = 100;
    this.attempts = 0;
    this.tools = {
      readFile: new ReadFile(),
      writeFile: new WriteFile(),
      exploreDir: new ExploreDir(),
    };
  }

  private async _executeToolRequest(request: ToolRequest, workingDir: string): Promise<ToolResult<ToolResultMap[ToolName]>> {
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

      default:
        throw new Error(`Unknown tool: ${request.tool}`);
    }
  }

  private async _processResponse(response: string, workingDir: string): Promise<string> {
    const toolMatch = response.match(/```tool\n([\s\S]*?)```/);
    if (!toolMatch) return response;

    try {
      const toolRequest: ToolRequest = JSON.parse(toolMatch[1]);
      const result = await this._executeToolRequest(toolRequest, workingDir);

      // Replace the tool request with the result
      return response.replace(/```tool\n[\s\S]*?```/, "```result\n" + JSON.stringify(result, null, 2) + "\n```");
    } catch (error) {
      // Replace the tool request with the error
      return response.replace(
        /```tool\n[\s\S]*?```/,
        "```result\n" +
          JSON.stringify(
            {
              success: false,
              error: error instanceof Error ? error.message : "Unknown error",
            },
            null,
            2
          ) +
          "\n```"
      );
    }
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
    this.attempts++;

    if (this.attempts > MAX_TRIES) {
      return {
        success: false,
        error: `Maximum attempts (${MAX_TRIES}) exceeded`,
        metadata: {
          timestamp: Date.now(),
          toolName: tool.name,
          attempts: this.attempts,
          workingDir,
        },
      };
    }

    try {
      const result = await tool.execute(...args);

      if (!result.success && this.attempts < MAX_TRIES) {
        console.log(`Attempt ${this.attempts} failed: ${result.error}`);
        return this._executeWithRetry(tool, method, workingDir, ...args);
      }

      return result;
    } catch (error) {
      if (this.attempts < MAX_TRIES) {
        console.error(`Attempt ${this.attempts} error:`, error);
        return this._executeWithRetry(tool, method, workingDir, ...args);
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
        metadata: {
          timestamp: Date.now(),
          toolName: tool.name,
          attempts: this.attempts,
          workingDir,
        },
      };
    }
  }

  async createCompletion(prompt: string, model: string, workingDir: string, currentSolution: string = "") {
    // Reset attempts counter for new completion
    this.attempts = 0;

    // Update tools with working directory
    this.tools.exploreDir = new ExploreDir(workingDir);

    let isSolved = false;
    let finalResponse: OpenAI.Chat.Completions.ChatCompletion | null = null;
    const conversationHistory: ChatMessage[] = [
      {
        role: "system",
        content: sysMsg,
      },
    ];

    while (this.attempts < MAX_TRIES && !isSolved) {
      // Add the current state to conversation
      conversationHistory.push({
        role: "user",
        content: `Current attempt: ${this.attempts + 1}/${MAX_TRIES}\nWorking directory: ${workingDir}\nPrevious solution state: ${currentSolution}\n\nOriginal request: ${prompt}`,
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
        this.attempts++;
        console.log(`Solution incomplete, attempt ${this.attempts}/${MAX_TRIES}`);
      }
    }

    return finalResponse;
  }

  // Helper methods to execute tools with retry logic
  private async _readFile(filename: string, workingDir: string) {
    return this._executeWithRetry(this.tools.readFile, "execute", workingDir, `${workingDir}/${filename}`);
  }

  private async _writeFile(filename: string, content: string, workingDir: string) {
    return this._executeWithRetry(this.tools.writeFile, "execute", workingDir, `${workingDir}/${filename}`, content);
  }

  private async _getDirectoryTree(workingDir: string) {
    return this._executeWithRetry(this.tools.exploreDir, "execute", workingDir, "tree");
  }
}
