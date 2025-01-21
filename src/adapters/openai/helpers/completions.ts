import OpenAI from "openai";
import { Context } from "../../../types/context";
import { SuperOpenAi } from "./openai";

import { Tool, ToolResult, ToolResultMap, DirectoryExploreResult } from "../../../types/tool";
import { ReadFile } from "../../../tools/read-file";
import { WriteFile } from "../../../tools/write-file";
import { ExploreDir } from "../../../tools/explore-dir";
import { SearchFiles } from "../../../tools/search-files";
import { CreatePr } from "../../../tools/create-pr";
import { AnalyzeCode } from "../../../tools/analyze-code";
import { TestRunner } from "../../../tools/test-runner";
import { Terminal } from "../../../tools/terminal";

const MAX_TRIES = 10;
const MAX_RETRY_MALFORMED = 1;
const MAX_PROMPT_SIZE = 65536; // 64KB limit

function middleOutTransform(prompt: string, maxSize: number): string {
  if (prompt.length <= maxSize) return prompt;

  // Calculate how much we need to remove
  const excess = prompt.length - maxSize;

  // Keep start and end portions intact
  const portionSize = Math.floor((maxSize - excess) / 2);

  // Extract start and end portions
  const start = prompt.slice(0, portionSize);
  const end = prompt.slice(-portionSize);

  // Add ellipsis in the middle
  return `${start}\n...[Content truncated for size]...\n${end}`;
}

const sysMsg = `You are a capable AI assistant currently running on a GitHub bot. 
You are designed to assist with resolving issues by making incremental fixes using a standardized tool interface.
Each tool implements a common interface that provides consistent error handling and result reporting.

Workflow:
1. The repository has already been cloned and you are in the correct working directory
2. The end goal is solve the issue by making the changes, once the issue is resolved, this would be converted into a pull request.
3. After each attempt to solve the issue by using an appropriate tool, you will receive feedback, if the attempt was successful or not for example if you want to make change to file you would use the writeFile tool to make the change, this is just an example.
4. If not complete, you will continue with additional attempts up to ${MAX_TRIES} tries
5. Each attempt should build upon previous attempts, learning from any failures
6. For write tool, you must use the diff format to make changes to the file.

To use tools, you can include one or more tool calls in your response. Each tool call should be formatted like this:
\`\`\`tool
{
  "type": "function",
  "function": {
    "name": "readFile|writeFile|exploreDir|searchFiles|analyzeCode|testRunner",
    "arguments": {
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

      // For analyzeCode:
      "path": "/absolute/path/to/file/or/directory"

      // For testRunner:
      "projectPath": "path to project root (optional)"
    }
  }
}
\`\`\`

Multiple tool calls will be processed sequentially in the order they appear in your response. Each tool call will be replaced with its corresponding result.

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
- Method: execute(args: { filename: string })
- Returns: ToolResult<FileReadResult> containing:
  - success: boolean
  - data: { content: string, path: string }
  - error?: string
  - metadata: execution details

### WriteFile Tool ###
- Purpose: Update file contents using diff blocks
- Method: execute(args: { filename: string, content: string })
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
- Method: execute(args: { command: 'tree' | 'change-dir' | 'clone' | 'kill', dir?: string, repo?: string, owner?: string, issueNumber?: number })
- Returns: ToolResult<DirectoryExploreResult> containing:
  - success: boolean
  - data: { currentPath: string, tree?: string }
  - error?: string
  - metadata: execution details

### SearchFiles Tool ###
- Purpose: Search files using regex patterns
- Method: execute(args: { pattern: string, filePattern?: string, caseSensitive?: boolean, contextLines?: number })
- Returns: ToolResult<SearchResult> containing:
  - success: boolean
  - data: { 
    matches: Array<{ file: string, line: number, content: string, context: string[] }>,
    totalFiles: number,
    searchPattern: string
  }
  - error?: string
  - metadata: execution details

### AnalyzeCode Tool ###
- Purpose: Analyze source code to extract definitions using tree-sitter
- Method: execute(args: { path: string })
- Returns: ToolResult<CodeAnalysisResult> containing:
  - success: boolean
  - data: { definitions: string, path: string }
  - error?: string
  - metadata: execution details

### TestRunner Tool ###
- Purpose: Run tests and analyze results
- Method: execute(args: { projectPath?: string })
- Returns: ToolResult<TestRunnerResult> containing:
  - success: boolean
  - data: {
    success: boolean,
    testOutput?: string,
    failedTests?: string[],
    passedTests?: string[]
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
  analyzeCode: AnalyzeCode;
  testRunner: TestRunner;
}

type ToolName = keyof ToolResultMap;

interface InternalToolRequest {
  tool: ToolName;
  args: Record<string, unknown>;
}

interface ToolRequest {
  type: "function";
  function: {
    name: ToolName;
    arguments: Record<string, unknown>;
  };
}

function convertToInternalRequest(toolCall: ToolRequest): InternalToolRequest {
  return {
    tool: toolCall.function.name,
    args: toolCall.function.arguments,
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
  private _toolAttempts: Map<string, number>;
  private _terminal: Terminal;
  private workingDir: string;

  constructor(client: OpenAI, context: Context, workingDir: string = process.cwd()) {
    super(client, context);
    this.maxTokens = 100000;
    this.llmAttempts = 0;
    this._toolAttempts = new Map();
    this.workingDir = workingDir;
    this._terminal = new Terminal(workingDir);
    this.tools = {
      readFile: new ReadFile(),
      writeFile: new WriteFile(this.context),
      exploreDir: new ExploreDir(context),
      searchFiles: new SearchFiles(),
      createPr: new CreatePr(context),
      analyzeCode: new AnalyzeCode(),
      testRunner: new TestRunner(context),
    };
  }

  private async _executeToolRequest(request: InternalToolRequest, workingDir: string): Promise<ToolResult<ToolResultMap[ToolName]>> {
    this.context.logger.info(`Executing tool request: ${request.tool} with args:`, request.args);
    try {
      switch (request.tool) {
        case "readFile":
          if (!request.args.filename) throw new Error("Filename is required for readFile");
          return this._readFile(request.args.filename as string, workingDir);

        case "writeFile":
          if (!request.args.filename || !request.args.content) {
            throw new Error("Filename and content are required for writeFile");
          }
          return this._writeFile(request.args.filename as string, request.args.content as string, workingDir);

        case "exploreDir":
          return this._getDirectoryTree(workingDir);

        case "searchFiles":
          if (!request.args.pattern) throw new Error("Search pattern is required");
          return this._searchFiles(request.args.pattern as string, workingDir, {
            filePattern: request.args.filePattern as string,
            caseSensitive: request.args.caseSensitive as boolean,
            contextLines: request.args.contextLines as number,
          });

        case "analyzeCode":
          if (!request.args.path) throw new Error("Path is required for analyzeCode");
          return this._analyzeCode(request.args.path as string, workingDir);

        case "testRunner":
          return this._executeWithRetry(this.tools.testRunner, "execute", workingDir, request.args);

        default:
          throw new Error(`Unknown tool: ${request.tool}`);
      }
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      this.context.logger.error(`Tool execution failed:`, { error: errorObj });
      throw error;
    }
  }

  private async _fixMalformedWriteFile(
    malformedJson: string,
    workingDir: string,
    model: string,
    currentSolution: string,
    conversationHistory: ChatMessage[],
    totalInputToken: number = 0,
    totalOutputToken: number = 0
  ): Promise<{
    tool: ToolRequest;
    totalInputToken: number;
    totalOutputToken: number;
  }> {
    let attempts = 0;
    let lastError: Error | null = null;

    while (attempts < MAX_RETRY_MALFORMED) {
      try {
        this.context.logger.info(`Attempt ${attempts + 1} to fix malformed writeFile request`);

        // Get directory tree for context
        const treeResult = await this._getDirectoryTree(workingDir);
        const treeOutput = treeResult.success && treeResult.data ? (treeResult.data as DirectoryExploreResult).tree : "";

        const fixPrompt = `You are currently helping fix a GitHub issue. Here's the context:

Working Directory: ${workingDir}
Directory Structure:
${treeOutput}

Previous Solution State:
${currentSolution}

Previous Conversation:
${conversationHistory.map((msg) => `${msg.role}: ${msg.content}`).join("\n")}

The following writeFile tool request is malformed. Fix it to be valid JSON with properly escaped content:
${malformedJson}

Return only the fixed JSON without any explanation.`;

        // Create messages array ensuring proper interleaving
        const fixMessages = [
          {
            role: "system" as const,
            content:
              "You are a JSON fixer specializing in fixing malformed writeFile tool requests. You understand the context of the changes being made and ensure the content is properly escaped while maintaining the intended changes.",
          },
          {
            role: "user" as const,
            content: fixPrompt,
          },
        ];

        const fixResponse = await this.client.chat.completions.create({
          model,
          messages: fixMessages,
          temperature: 0,
        });

        const fixedJson = fixResponse.choices[0]?.message?.content?.trim() || "";

        //Add to the total input and output tokens
        if (fixResponse.usage) {
          totalInputToken += fixResponse.usage.prompt_tokens;
          totalOutputToken += fixResponse.usage.completion_tokens;
        }

        this.context.logger.info("LLM suggested fix:", { fixedJson });

        const toolCall = JSON.parse(fixedJson);
        if (!toolCall.type || toolCall.type !== "function" || !toolCall.function?.name || !toolCall.function?.arguments) {
          throw new Error("Fixed JSON is missing required fields");
        }

        return {
          tool: toolCall,
          totalInputToken,
          totalOutputToken,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        // Add error to conversation history only if last message wasn't from assistant
        if (conversationHistory[conversationHistory.length - 1].role !== "assistant") {
          conversationHistory.push({
            role: "assistant",
            content: `Failed to fix malformed JSON (attempt ${attempts + 1}): ${lastError.message}`,
          });
        } else {
          // Update the last assistant message instead
          conversationHistory[conversationHistory.length - 1].content += `\n\nFailed to fix malformed JSON (attempt ${attempts + 1}): ${lastError.message}`;
        }
        this.context.logger.error(`Failed to fix JSON (attempt ${attempts + 1}):`, { error: lastError });
        attempts++;
      }
    }

    throw new Error(`Failed to fix malformed JSON after ${MAX_RETRY_MALFORMED} attempts: ${lastError?.message}`);
  }

  private async _processResponse(
    response: string,
    workingDir: string,
    model: string,
    currentSolution: string,
    conversationHistory: ChatMessage[],
    totalInputToken: number = 0,
    totalOutputToken: number = 0
  ): Promise<{
    output: string;
    totalInputToken: number;
    totalOutputToken: number;
  }> {
    // Find all tool blocks in the response
    const toolBlocks = [...response.matchAll(/```tool\n([\s\S]*?)```/g)];
    if (toolBlocks.length === 0)
      return {
        output: response,
        totalInputToken,
        totalOutputToken,
      };

    let processedResponse = response;

    // Process each tool request sequentially
    for (const toolBlock of toolBlocks) {
      const fullMatch = toolBlock[0];
      const toolJson = toolBlock[1];

      try {
        // Trim any whitespace and ensure we have valid JSON
        const trimmedJson = toolJson.trim();
        if (!trimmedJson.endsWith("}")) {
          throw new Error("Malformed JSON: Missing closing brace");
        }

        this.context.logger.info(`Processing tool request:`, { toolJson: trimmedJson });
        let toolCall: ToolRequest;
        try {
          toolCall = JSON.parse(trimmedJson);
          this.context.logger.info(`Parsed tool call:`, { toolCall });
        } catch (error: unknown) {
          if (trimmedJson.includes('"name": "writeFile"')) {
            try {
              const output = await this._fixMalformedWriteFile(
                trimmedJson,
                workingDir,
                model,
                currentSolution,
                conversationHistory,
                totalInputToken,
                totalOutputToken
              );
              toolCall = output.tool;
              totalInputToken += output.totalInputToken;
              totalOutputToken += output.totalOutputToken;
              this.context.logger.info("Successfully fixed and parsed JSON");
              // Reset tool attempts since we're starting fresh with fixed JSON
              this._toolAttempts.set("writeFile", 0);
            } catch (fixError) {
              this.context.logger.error("Failed to fix malformed JSON:", { error: fixError instanceof Error ? fixError : new Error(String(fixError)) });
              throw fixError;
            }
          } else {
            const errorObj = error instanceof Error ? error : new Error(String(error));
            this.context.logger.error(`Failed to parse tool request JSON:`, {
              error: errorObj,
              toolJson: trimmedJson,
            });
            throw errorObj;
          }
        }

        // Validate required fields
        if (!toolCall.type || toolCall.type !== "function") {
          this.context.logger.error('Tool call missing required "type" field or not a function', { toolCall });
          throw new Error('Tool call must have type "function"');
        }
        if (!toolCall.function?.name) {
          this.context.logger.error('Tool call missing required "name" field', { toolCall });
          throw new Error('Tool call missing required "name" field');
        }
        if (!toolCall.function?.arguments) {
          this.context.logger.error('Tool call missing required "arguments" field', { toolCall });
          throw new Error('Tool call missing required "arguments" field');
        }

        this.context.logger.info(`Tool call validation passed`, { name: toolCall.function.name, arguments: toolCall.function.arguments });

        // For writeFile, ensure content is stringified if it's an object
        if (toolCall.function.name === "writeFile" && toolCall.function.arguments.content && typeof toolCall.function.arguments.content === "object") {
          //Check if the Diff format is used
          const content = toolCall.function.arguments.content as Record<string, unknown>;
          if (!content["<<<<< SEARCH"] || !content["======"] || !content[">>>>>> REPLACE"]) {
            throw new Error("Invalid diff format for writeFile content");
          }

          toolCall.function.arguments.content = JSON.stringify(toolCall.function.arguments.content, null, 2);
        }

        const result = await this._executeToolRequest(convertToInternalRequest(toolCall), workingDir);

        this.context.logger.info(`Tool execution result:` + { result });
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

    return {
      output: processedResponse,
      totalInputToken,
      totalOutputToken,
    };
  }

  private async _checkSolution(
    prompt: string,
    model: string,
    conversationHistory: ChatMessage[] = []
  ): Promise<{
    isSolved: boolean;
    conversationHistory: ChatMessage[];
    error?: string;
  }> {
    try {
      // Get the latest changes
      const diffResult = await this._terminal.runCommand("git diff");
      const stagedResult = await this._terminal.runCommand("git diff --staged");
      const changes = diffResult + stagedResult;

      // Run tests if available
      let testResults: ToolResult<ToolResultMap["testRunner"]> | null = null;
      try {
        testResults = await this.tools.testRunner.execute({});
      } catch (error) {
        this.context.logger.debug("Failed to run tests:" + error);
      }

      // Prepare evaluation prompt
      const evaluationPrompt = `You are evaluating if a solution properly addresses an issue. 
      
Original Issue:
${prompt}

Changes Made:
${changes}

${
  testResults
    ? `Test Results:
${JSON.stringify(testResults.data, null, 2)}`
    : ""
}

Previous Attempts Context:
${conversationHistory.map((msg) => `${msg.role}: ${msg.content}`).join("\n")}

Evaluate if the changes properly solve the original issue. Consider:
1. Do the changes directly address the problem described?
2. Are there any potential side effects or regressions?
4. Is the implementation complete and robust?

Respond with:
1. A boolean "solved: true/false"
2. A detailed explanation of why the solution works or what's missing`;

      // Create evaluation messages ensuring proper interleaving
      const evaluationMessages = [
        {
          role: "system" as const,
          content: "You are a code review expert who evaluates if changes properly solve issues.",
        },
        {
          role: "user" as const,
          content: evaluationPrompt,
        },
      ];

      const evaluation = await this.client.chat.completions.create({
        model,
        messages: evaluationMessages,
        temperature: 0,
      });

      const response = evaluation.choices[0]?.message?.content || "";
      const isSolved = response.toLowerCase().includes("solved: true");

      // Add evaluation to conversation history only if last message wasn't from assistant
      if (conversationHistory[conversationHistory.length - 1].role !== "assistant") {
        conversationHistory.push({
          role: "assistant",
          content: `Solution evaluation: ${response}`,
        });
      } else {
        // Update the last assistant message instead
        conversationHistory[conversationHistory.length - 1].content += `\n\nSolution evaluation: ${response}`;
      }

      if (!isSolved) {
        // Extract error message from evaluation
        const errorMatch = response.match(/(?:what's missing|problems?|issues?|errors?):?\s*([^\n]+)/i);
        const error = errorMatch ? errorMatch[1].trim() : "Solution does not fully address the issue";

        return {
          isSolved: false,
          conversationHistory,
          error,
        };
      }

      return {
        isSolved: true,
        conversationHistory,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.context.logger.error("Failed to check solution:" + errorMsg);

      conversationHistory.push({
        role: "assistant",
        content: `Failed to validate solution: ${errorMsg}`,
      });

      return {
        isSolved: false,
        conversationHistory,
        error: errorMsg,
      };
    }
  }

  private async _executeWithRetry<T extends ToolName>(
    tool: Tool<ToolResultMap[T]>,
    method: string,
    workingDir: string,
    args: Record<string, unknown>
  ): Promise<ToolResult<ToolResultMap[T]>> {
    const currentAttempts = (this._toolAttempts.get(tool.name) || 0) + 1;
    this._toolAttempts.set(tool.name, currentAttempts);

    if (currentAttempts > MAX_TRIES) {
      const error = new Error(`Maximum attempts (${MAX_TRIES}) exceeded for tool ${tool.name}`);
      this.context.logger.error(`Tool retry limit exceeded:`, { error, tool: tool.name });
      return {
        success: false,
        error: error.message,
        metadata: {
          timestamp: Date.now(),
          toolName: tool.name,
          toolAttempts: currentAttempts,
          workingDir,
        },
      };
    }

    try {
      const result = await tool.execute(args);

      if (!result.success && currentAttempts < MAX_TRIES) {
        const error = new Error(result.error || "Unknown error");
        this.context.logger.error(`Tool attempt ${currentAttempts} failed:`, { error, tool: tool.name });
        return this._executeWithRetry(tool, method, workingDir, args);
      }

      if (result.success) {
        this.context.logger.info(`Tool execution successful:`, {
          toolName: tool.name,
          data: result.data,
          metadata: result.metadata,
        });
        // Reset attempts on success
        this._toolAttempts.set(tool.name, 0);
      }

      return result;
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      this.context.logger.error(`Tool attempt ${currentAttempts} error:`, { error: errorObj, tool: tool.name });

      if (currentAttempts < MAX_TRIES) {
        return this._executeWithRetry(tool, method, workingDir, args);
      }

      return {
        success: false,
        error: errorObj.message,
        metadata: {
          timestamp: Date.now(),
          toolName: tool.name,
          toolAttempts: currentAttempts,
          workingDir,
        },
      };
    }
  }

  async createCompletion(prompt: string, model: string, workingDir: string, currentSolution: string = "") {
    // Validate and transform prompt if needed
    let processedPrompt = prompt;
    if (prompt.length > MAX_PROMPT_SIZE) {
      this.context.logger.info(`Prompt exceeds 64KB limit (${prompt.length} bytes), applying middle-out transform`);
      processedPrompt = middleOutTransform(prompt, MAX_PROMPT_SIZE);
    }

    // Reset attempts counter for new completion
    this.llmAttempts = 0;
    this._toolAttempts.clear();

    // Update tools with working directory
    this.tools.exploreDir = new ExploreDir(this.context, workingDir);
    this.tools.createPr = new CreatePr(this.context, workingDir);
    this.tools.searchFiles = new SearchFiles(workingDir);
    this.tools.analyzeCode = new AnalyzeCode(workingDir);
    this.tools.testRunner = new TestRunner(this.context, workingDir);

    let isSolved = false;
    let finalResponse: OpenAI.Chat.Completions.ChatCompletion | null = null;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let pullRequestResult: ToolResult<ToolResultMap["createPr"]> | null = null;
    let conversationHistory: ChatMessage[] = [
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

      // Ensure messages are properly interleaved by combining state info with last assistant message if it exists
      const lastMessage = conversationHistory[conversationHistory.length - 1];
      const stateInfo = `Current LLM attempt: ${this.llmAttempts + 1}/${MAX_TRIES}\nWorking directory: ${workingDir}\n\nDirectory structure:\n${treeOutput}\n\nPrevious solution state: ${currentSolution}\n\nOriginal request: ${processedPrompt}`;

      if (lastMessage.role === "assistant") {
        // If last message was from assistant, add new user message
        conversationHistory.push({
          role: "user",
          content: stateInfo,
        });
      } else {
        // If last message was from user/system, update it to include state info
        conversationHistory[conversationHistory.length - 1].content += "\n\n" + stateInfo;
      }

      const res = await this.client.chat.completions.create({
        model,
        messages: conversationHistory,
        temperature: 0.2,
        frequency_penalty: 0,
        presence_penalty: 0,
      });

      this.context.logger.info("LLM response: " + JSON.stringify(res, null, 2));

      // Track token usage
      if (res.usage) {
        totalInputTokens += res.usage.prompt_tokens;
        totalOutputTokens += res.usage.completion_tokens;
      }

      finalResponse = res;

      // Get the LLM's response
      const llmResponse = res.choices[0]?.message?.content || "";

      // Process any tool requests in the response
      const processedResponse = await this._processResponse(
        llmResponse,
        workingDir,
        model,
        currentSolution,
        conversationHistory,
        totalInputTokens,
        totalOutputTokens
      );

      // Only add assistant response if last message was from user/system
      if (conversationHistory[conversationHistory.length - 1].role !== "assistant") {
        conversationHistory.push({
          role: "assistant",
          content: processedResponse.output,
        });
      } else {
        // Update the last assistant message instead of adding a new one
        conversationHistory[conversationHistory.length - 1].content += "\n\n" + processedResponse.output;
      }

      // Update current solution state
      currentSolution = processedResponse.output;

      // Update token usage
      totalInputTokens += processedResponse.totalInputToken;
      totalOutputTokens += processedResponse.totalOutputToken;

      // Check if the solution is complete
      const solOutput = await this._checkSolution(currentSolution, model, conversationHistory);
      isSolved = solOutput.isSolved;
      conversationHistory = solOutput.conversationHistory;

      if (solOutput.error) {
        this.context.logger.error("Solution validation failed:" + { error: solOutput.error });
      }

      if (!isSolved) {
        this.llmAttempts++;
        this.context.logger.info(`Solution incomplete, attempt ${this.llmAttempts}/${MAX_TRIES}`);
      }
    }

    if (isSolved || this.llmAttempts >= MAX_TRIES) {
      // Create a pull request with the changes
      const prTitle = `Fix: ${prompt.split("\n")[0]}`; // Use first line of prompt as PR title

      // Add token usage information to PR body
      const prBody = `This PR addresses the following:

${prompt}

Changes made:
${currentSolution}

Token Usage:
- Total Input Tokens: ${totalInputTokens}
- Total Output Tokens: ${totalOutputTokens}
- Total Tokens: ${totalInputTokens + totalOutputTokens}`;

      pullRequestResult = (await this._createPullRequest(prTitle, prBody, workingDir)) as ToolResult<ToolResultMap["createPr"]>;
      if (pullRequestResult.success) {
        this.context.logger.info("Created pull request:", {
          data: pullRequestResult.data,
          metadata: pullRequestResult.metadata,
        });
      } else {
        this.context.logger.error("Failed to create pull request:", {
          error: new Error(pullRequestResult.error || "Unknown error"),
          metadata: pullRequestResult.metadata,
        });
      }
    }

    // Return enhanced response with token counts and PR link
    return {
      completion: finalResponse,
      prUrl: pullRequestResult?.success ? (pullRequestResult.data as { url?: string })?.url || null : null,
      tokenUsage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
      },
    };
  }

  private async _createPullRequest(title: string, body: string, workingDir: string) {
    return this._executeWithRetry(this.tools.createPr, "execute", workingDir, { title, body, workingDir });
  }

  // Helper methods to execute tools with retry logic
  private async _readFile(filename: string, workingDir: string) {
    return this._executeWithRetry(this.tools.readFile, "execute", workingDir, { filename });
  }

  private async _writeFile(filename: string, content: string, workingDir: string) {
    return this._executeWithRetry(this.tools.writeFile, "execute", workingDir, { filename, content });
  }

  private async _getDirectoryTree(workingDir: string) {
    return this._executeWithRetry(this.tools.exploreDir, "execute", workingDir, { command: "tree" });
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
    return this._executeWithRetry(this.tools.searchFiles, "execute", workingDir, {
      pattern,
      ...options,
    });
  }

  private async _analyzeCode(path: string, workingDir: string) {
    return this._executeWithRetry(this.tools.analyzeCode, "execute", workingDir, { path });
  }
}
