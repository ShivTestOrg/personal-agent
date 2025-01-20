import { Tool, ToolResult, JSONSchemaDefinition } from "../../types/tool";
import { detectTestConfiguration } from "../../helpers/test-config";
import { Context } from "../../types/context";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface TestRunnerResult {
  success: boolean;
  testOutput?: string;
  failedTests?: string[];
  passedTests?: string[];
  suggestions?: string[];
}

export class TestRunner implements Tool<TestRunnerResult> {
  readonly name = "testRunner";
  readonly description = "Run tests and analyze results";
  readonly parameters: JSONSchemaDefinition = {
    type: "object",
    properties: {
      projectPath: {
        type: "string",
        description: "Path to the project root",
      },
    },
    required: [],
  };

  private workingDir: string;
  private context: Context;

  constructor(context: Context, workingDir: string = process.cwd()) {
    this.workingDir = workingDir;
    this.context = context;
  }

  async execute(args: { projectPath?: string }): Promise<ToolResult<TestRunnerResult>> {
    try {
      const projectPath = args.projectPath || this.workingDir;

      const config = await detectTestConfiguration(projectPath);
      const { stdout, stderr } = await execAsync(config.command, {
        cwd: projectPath,
      });

      const testOutput = stdout + stderr;
      const failedTestsMatch = testOutput.match(/Tests:\s+(\d+)\s+failed/i);
      const passedTestsMatch = testOutput.match(/Tests:\s+(\d+)\s+passed/i);

      const failedTests = failedTestsMatch ? Array(parseInt(failedTestsMatch[1])).fill("Test failed") : [];
      const passedTests = passedTestsMatch ? Array(parseInt(passedTestsMatch[1])).fill("Test passed") : [];

      return {
        success: true,
        data: {
          success: failedTests.length === 0,
          testOutput,
          failedTests,
          passedTests,
        },
        metadata: {
          timestamp: Date.now(),
          toolName: this.name,
        },
      };
    } catch (error) {
      this.context.logger.error("Error running test" + error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          timestamp: Date.now(),
          toolName: this.name,
        },
      };
    }
  }
}
