import { Terminal } from "../terminal";
import { Tool, ToolResult, DirectoryExploreResult, JSONSchemaDefinition } from "../../types/tool";
import { Context } from "../../types/context";

export class ExploreDir implements Tool<DirectoryExploreResult> {
  readonly name = "exploreDir";
  readonly description = "Explores and manipulates directories, including git operations";
  readonly parameters: JSONSchemaDefinition = {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Command to execute",
        enum: ["change-dir", "tree", "clone", "kill"],
      },
      dir: {
        type: "string",
        description: "Directory path for change-dir command",
      },
      repo: {
        type: "string",
        description: "Repository name for clone command",
      },
      owner: {
        type: "string",
        description: "Repository owner for clone command",
      },
      issueNumber: {
        type: "number",
        description: "Issue number for clone command",
      },
    },
    required: ["command"],
  };

  private _shellInterface: Terminal;
  private _currentDir: string;
  private _tempDir: string | null = null;
  private _context: Context;

  constructor(context: Context, workDir: string = "") {
    this._context = context;
    this._shellInterface = new Terminal();
    this._currentDir = workDir;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult<DirectoryExploreResult>> {
    const command = args.command as "change-dir" | "tree" | "clone" | "kill";

    try {
      switch (command) {
        case "change-dir": {
          const dir = args.dir;
          if (typeof dir !== "string") {
            throw new Error("Directory path must be a string");
          }
          await this._changeDir(dir);
          break;
        }
        case "tree": {
          const tree = await this._currentDirTree();
          return {
            success: true,
            data: {
              currentPath: this._currentDir,
              tree,
            },
            metadata: {
              timestamp: Date.now(),
              toolName: this.name,
            },
          };
        }
        case "clone": {
          const { repo, owner, issueNumber } = args;
          if (!repo || !owner || !issueNumber || typeof repo !== "string" || typeof owner !== "string" || typeof issueNumber !== "number") {
            throw new Error("Missing required clone arguments");
          }
          await this._cloneRepo(repo, owner, issueNumber);
          break;
        }
        case "kill": {
          await this._kill();
          break;
        }
        default:
          throw new Error(`Unknown command: ${command}`);
      }

      return {
        success: true,
        data: {
          currentPath: this._currentDir,
        },
        metadata: {
          timestamp: Date.now(),
          toolName: this.name,
          command,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
        data: {
          currentPath: this._currentDir,
        },
        metadata: {
          timestamp: Date.now(),
          toolName: this.name,
          command,
        },
      };
    }
  }

  private async _kill(): Promise<void> {
    if (this._tempDir) {
      console.log(`Removing temp directory: ${this._tempDir}`);
      await this._shellInterface.runCommand(`rm -rf ${this._tempDir}`);
    }
  }

  private async _changeDir(dir: string): Promise<void> {
    await this._shellInterface.runCommand(`cd ${dir}`);
    this._currentDir = dir;
  }

  getCurrentWorkingDir(): string {
    return this._currentDir;
  }

  private async _makeTempDir(): Promise<string> {
    const randomName = Math.random().toString(36).substring(7);
    const tempDir = await this._shellInterface.runCommand(`mktemp -d -t personal-agent-${randomName}-XXXXXX`);
    return tempDir.trim();
  }

  private async _currentDirTree(): Promise<string> {
    const treeOutput = await this._shellInterface.runCommand("which tree");
    if (treeOutput === "") {
      throw new Error("Tree command not found");
    }
    return this._shellInterface.runCommand(`tree --gitignore ${this._currentDir}`);
  }

  private async _cloneRepo(repo: string, owner: string, issueNumber: number): Promise<void> {
    this._currentDir = await this._makeTempDir();
    const token = this._context.env.PERSONAL_AGENT_PAT_CLASSIC;
    const command = `git clone https://x-access-token:${token}@github.com/${owner}/${repo}.git ${this._currentDir} && cd ${this._currentDir} && git checkout -b issue-${issueNumber}`;
    await this._shellInterface.runCommand(command);

    //Print the current pwd
    const val = await this._shellInterface.runCommand("pwd");
    console.log(val);
    this._context.logger.info(`Current working directory: ${val}`);
  }
}
