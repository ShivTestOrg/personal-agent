import { Terminal } from "../terminal";
import { Tool, ToolResult, DirectoryExploreResult } from "../../types/tool";

export class ExploreDir implements Tool<DirectoryExploreResult> {
  readonly name = "explore-dir";
  readonly description = "Explores and manipulates directories, including git operations";

  private _shellInterface: Terminal;
  private _currentDir: string;
  private _tempDir: string | null = null;

  constructor(workDir: string = "") {
    this._shellInterface = new Terminal();
    this._currentDir = workDir;
  }

  async execute(command: "change-dir" | "tree" | "clone" | "kill", args?: Record<string, unknown>): Promise<ToolResult<DirectoryExploreResult>> {
    try {
      switch (command) {
        case "change-dir": {
          const dir = args?.dir;
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
          const { repo, owner, issueNumber } = args || {};
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
    const tempDir = await this._shellInterface.runCommand(`mktemp -d -t personal-agent-${randomName}`);
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
    const command = `git clone https://github.com/ShivTestOrg/test-public.git ${this._currentDir} && cd ${this._currentDir} && git checkout -b issue-${issueNumber}`;
    await this._shellInterface.runCommand(command);
  }
}
