export interface ToolResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: {
    timestamp: number;
    toolName: string;
    [key: string]: number | string;
  };
}

export interface JSONSchemaDefinition {
  type: string;
  description?: string;
  enum?: string[];
  items?: {
    type: string;
    properties?: Record<string, JSONSchemaDefinition>;
  };
  properties?: Record<string, JSONSchemaDefinition>;
  required?: string[];
}

export interface ToolFunction {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JSONSchemaDefinition;
  };
}

export interface Tool<T = unknown> {
  name: string;
  description: string;
  parameters: JSONSchemaDefinition;
  execute(args: Record<string, unknown>): Promise<ToolResult<T>>;
}

export interface OpenAITool<T = unknown> {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JSONSchemaDefinition;
    execute?(args: Record<string, unknown>): Promise<ToolResult<T>>;
  };
}

export function convertToOpenAITool<T>(tool: Tool<T>): OpenAITool<T> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: tool.execute,
    },
  };
}

// Tool Results
export interface FileReadResult {
  content: string;
  path: string;
}

export interface FileWriteResult {
  path: string;
  bytesWritten: number;
  diffBlocksApplied?: number;
}

export interface DirectoryExploreResult {
  currentPath: string;
  tree?: string;
  error?: string;
}

export interface TerminalCommandResult {
  output: string;
  exitCode: number;
  command: string;
}

export interface SearchResult {
  matches: Array<{
    file: string;
    line: number;
    content: string;
    context: string[];
  }>;
  totalFiles: number;
  searchPattern: string;
}

export interface PullRequestResult {
  url: string;
  number: number;
  title: string;
}

// Tool Function Definitions
export const toolFunctions: Record<string, ToolFunction> = {
  readFile: {
    type: "function",
    function: {
      name: "readFile",
      description: "Read content from a file at the specified path",
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "Absolute path to the file",
          },
        },
        required: ["filename"],
      },
    },
  },
  writeFile: {
    type: "function",
    function: {
      name: "writeFile",
      description: "Write content to a file at the specified path",
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "Absolute path to the file",
          },
          content: {
            type: "string",
            description: "Content to write to the file",
          },
        },
        required: ["filename", "content"],
      },
    },
  },
  exploreDir: {
    type: "function",
    function: {
      name: "exploreDir",
      description: "Explore directory contents",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            enum: ["tree"],
            description: "Command to execute",
          },
        },
        required: ["command"],
      },
    },
  },
  searchFiles: {
    type: "function",
    function: {
      name: "searchFiles",
      description: "Search files using regex patterns",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Regex pattern to search for",
          },
          filePattern: {
            type: "string",
            description: "Optional glob pattern to filter files",
          },
          caseSensitive: {
            type: "boolean",
            description: "Whether to perform case-sensitive search",
          },
          contextLines: {
            type: "number",
            description: "Number of context lines to include",
          },
        },
        required: ["pattern"],
      },
    },
  },
  analyzeCode: {
    type: "function",
    function: {
      name: "analyzeCode",
      description: "Analyze source code to extract definitions using tree-sitter",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the file or directory to analyze",
          },
        },
        required: ["path"],
      },
    },
  },
  testRunner: {
    type: "function",
    function: {
      name: "testRunner",
      description: "Generate and run tests using TDD principles",
      parameters: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["run", "generate"],
            description: "Whether to run existing tests or generate new ones",
          },
          functionCode: {
            type: "string",
            description: "The function code to generate tests for",
          },
          testDescription: {
            type: "string",
            description: "Description of what the test should verify",
          },
          projectPath: {
            type: "string",
            description: "Path to the project root",
          },
        },
        required: ["mode"],
      },
    },
  },
};

export interface CodeAnalysisResult {
  definitions: string;
  path: string;
}

export interface TestRunnerResult {
  success: boolean;
  testOutput?: string;
  failedTests?: string[];
  passedTests?: string[];
  suggestions?: string[];
}

export type ToolResultMap = {
  readFile: FileReadResult;
  writeFile: FileWriteResult;
  exploreDir: DirectoryExploreResult;
  terminal: TerminalCommandResult;
  searchFiles: SearchResult;
  createPr: PullRequestResult;
  analyzeCode: CodeAnalysisResult;
  testRunner: TestRunnerResult;
};
