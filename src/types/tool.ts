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

export interface FunctionParameters {
  type: "object";
  properties: Record<
    string,
    {
      type: string;
      description?: string;
      enum?: string[];
      items?: {
        type: string;
        properties?: Record<string, unknown>;
      };
    }
  >;
  required?: string[];
}

export interface Tool<T = unknown> {
  name: string;
  description: string;
  parameters: FunctionParameters;
  execute(args: Record<string, unknown>): Promise<ToolResult<T>>;
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
export const toolFunctions = {
  readFile: {
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
  writeFile: {
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
  exploreDir: {
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
  searchFiles: {
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
};

export type ToolResultMap = {
  readFile: FileReadResult;
  writeFile: FileWriteResult;
  exploreDir: DirectoryExploreResult;
  terminal: TerminalCommandResult;
  searchFiles: SearchResult;
  createPr: PullRequestResult;
};
