import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { Tool, ToolResult, TerminalCommandResult, FunctionParameters } from "../../types/tool";

const execFilePromise = promisify(execFile);

export class Terminal implements Tool<TerminalCommandResult> {
  readonly name = "terminal";
  readonly description = "Executes shell commands in a terminal environment";
  readonly parameters: FunctionParameters = {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute",
      },
    },
    required: ["command"],
  };

  private _cwd: string;

  constructor(private _workdir: string = process.cwd()) {
    this._cwd = _workdir;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult<TerminalCommandResult>> {
    try {
      const command = args.command as string;
      if (!command) {
        throw new Error("Command is required");
      }

      if (command.startsWith("cd ")) {
        const dir = command.slice(3).trim();
        const targetDir = resolve(this._cwd, dir);
        if (existsSync(targetDir) && isDirectory(targetDir)) {
          this._cwd = targetDir;
          return {
            success: true,
            data: {
              output: "",
              exitCode: 0,
              command,
            },
            metadata: {
              timestamp: Date.now(),
              toolName: this.name,
              cwd: this._cwd,
            },
          };
        } else {
          throw new Error(`Directory '${dir}' does not exist.`);
        }
      } else {
        const { stdout } = await execFilePromise("/bin/bash", ["-c", command], {
          cwd: this._cwd,
          encoding: "utf8",
        });

        return {
          success: true,
          data: {
            output: stdout,
            exitCode: 0,
            command,
          },
          metadata: {
            timestamp: Date.now(),
            toolName: this.name,
            cwd: this._cwd,
          },
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
        metadata: {
          timestamp: Date.now(),
          toolName: this.name,
          command: args.command as string,
          cwd: this._cwd,
        },
      };
    }
  }

  async runCommand(command: string): Promise<string> {
    const result = await this.execute({ command });
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.data?.output ?? "";
  }
}

function isDirectory(path: string): boolean {
  try {
    const stats = statSync(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

export function commonCallback(id: string) {
  return (data: string) => {
    console.log(`Terminal ${id} output: ${data}`);
  };
}

export class TerminalManager {
  private _terminals: Map<string, Terminal>;

  constructor() {
    this._terminals = new Map();
    this.init();
  }

  init() {
    console.log("TerminalManager initialized");
  }

  createTerminal(id: string) {
    if (this._terminals.has(id)) {
      console.error(`Terminal with id ${id} already exists.`);
      return;
    }
    const terminal = new Terminal();
    this._terminals.set(id, terminal);
    console.log(`Terminal with id ${id} created.`);
  }

  async runCommandInTerminal(id: string, command: string) {
    const terminal = this._terminals.get(id);
    if (terminal) {
      try {
        const result = await terminal.execute({ command });
        if (result.success && result.data) {
          console.log(`Command executed in terminal ${id}: ${result.data.output}`);
        } else {
          console.error(`Error executing command in terminal ${id}: ${result.error}`);
        }
      } catch (error) {
        console.error(`Error executing command in terminal ${id}: ${error}`);
      }
    } else {
      console.error(`Terminal with id ${id} does not exist.`);
    }
  }

  killTerminal(id: string) {
    const terminal = this._terminals.get(id);
    if (terminal) {
      this._terminals.delete(id);
      console.log(`Terminal with id ${id} killed.`);
    } else {
      console.error(`Terminal with id ${id} does not exist.`);
    }
  }
}
