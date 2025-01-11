import { Tool, ToolResult, FunctionParameters } from "../../types/tool";
import { Context } from "../../types/context";
import { Terminal } from "../terminal";

export interface PullRequestResult {
  url: string;
  number: number;
  title: string;
}

export class CreatePr implements Tool<PullRequestResult> {
  readonly name = "createPr";
  readonly description = "Creates a pull request with the changes";
  readonly parameters: FunctionParameters = {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Title of the pull request",
      },
      body: {
        type: "string",
        description: "Description/body of the pull request",
      },
    },
    required: ["title", "body"],
  };

  private _context: Context;
  private _terminal: Terminal;

  constructor(context: Context, workDir: string = "") {
    this._context = context;
    this._terminal = new Terminal(workDir);
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult<PullRequestResult>> {
    try {
      const title = args.title as string;
      const body = args.body as string;

      if (!title || !body) {
        throw new Error("Title and body are required");
      }

      try {
        // Stage all changes
        this._context.logger.info("Staging changes");
        await this._terminal.runCommand("git add .");

        // Get status to log what's being committed
        const status = await this._terminal.runCommand("git status");
        this._context.logger.info("Changes to be committed:", { status });

        // Only proceed if there are changes to commit
        if (!status.trim()) {
          throw new Error("No changes to commit. Please make changes before creating a pull request.");
        }

        // Commit changes
        this._context.logger.info("Committing changes");
        await this._terminal.runCommand(`git commit -m "${title}"`);

        // Push to remote
        const currentBranch = (await this._terminal.runCommand("git rev-parse --abbrev-ref HEAD")).trim();
        this._context.logger.info(`Pushing branch ${currentBranch} to remote`);
        await this._terminal.runCommand(`git push origin ${currentBranch}`);
      } catch (error) {
        console.log("Error:", error);
        const gitError = error instanceof Error ? error : new Error(String(error));
        this._context.logger.error("Git operation failed:", { error: gitError });
        throw gitError;
      }

      this._context.logger.info("Creating pull request");
      const repo = this._context.payload.repository.name;
      const owner = this._context.payload.repository.owner.login;
      const response = await this._context.octokit.pulls.create({
        owner: owner,
        repo: repo,
        title,
        body,
        head: (await this._terminal.runCommand("git rev-parse --abbrev-ref HEAD")).trim(),
        base: "development",
      });

      return {
        success: true,
        data: {
          url: response.data.html_url,
          number: response.data.number,
          title: response.data.title,
        },
        metadata: {
          timestamp: Date.now(),
          toolName: this.name,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
        metadata: {
          timestamp: Date.now(),
          toolName: this.name,
        },
      };
    }
  }
}
