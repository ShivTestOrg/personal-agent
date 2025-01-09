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

export interface Tool<T = unknown> {
  name: string;
  description: string;
  execute(...args: unknown[]): Promise<ToolResult<T>>;
}

// Specific tool interfaces
export interface FileReadResult {
  content: string;
  path: string;
}

export interface FileWriteResult {
  path: string;
  bytesWritten: number;
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

// Tool result type mapping
export type ToolResultMap = {
  readFile: FileReadResult;
  writeFile: FileWriteResult;
  exploreDir: DirectoryExploreResult;
  terminal: TerminalCommandResult;
  searchFiles: SearchResult;
};
