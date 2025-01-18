import { Tool, ToolResult, FunctionParameters } from "../../types/tool";
import { detectTestConfiguration } from "../../helpers/test-config";
import { Context } from "../../types/context";
import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import OpenAI from "openai";

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
  readonly description = "Generate and run tests using TDD principles";
  readonly parameters: FunctionParameters = {
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
  };

  private workingDir: string;
  private context: Context;
  private client: OpenAI;

  constructor(client: OpenAI, context: Context, workingDir: string = process.cwd()) {
    this.workingDir = workingDir;
    this.client = client;
    this.context = context;
  }

  async generateTestCase(functionCode: string, description: string): Promise<string> {
    const prompt = `Given this TypeScript function:

${functionCode}

Generate a test case that ${description}. The test should:
1. Follow Jest testing patterns
2. Include proper assertions
3. Handle async operations if present
4. Follow TDD principles by testing expected behavior

Return only the test code without any explanation.`;

    const completion = await this.client.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    return completion.choices[0]?.message?.content || "";
  }

  async analyzeTestOutput(output: string): Promise<{
    failedTests: string[];
    passedTests: string[];
    suggestions: string[];
  }> {
    const prompt = `Analyze this test output and provide:
1. List of failed tests
2. List of passed tests
3. Suggestions for fixing failed tests

${output}

Format response as JSON with properties: failedTests (array), passedTests (array), suggestions (array)`;

    const completion = await this.client.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const response = completion.choices[0]?.message?.content || "{}";
    return JSON.parse(response);
  }

  async execute(args: {
    mode: "run" | "generate";
    functionCode?: string;
    testDescription?: string;
    projectPath?: string;
  }): Promise<ToolResult<TestRunnerResult>> {
    try {
      const projectPath = args.projectPath || this.workingDir;

      if (args.mode === "generate" && args.functionCode && args.testDescription) {
        const testCode = await this.generateTestCase(args.functionCode, args.testDescription);
        return {
          success: true,
          data: {
            success: true,
            testOutput: testCode,
          },
          metadata: {
            timestamp: Date.now(),
            toolName: this.name,
          },
        };
      }

      // Run tests
      const config = await detectTestConfiguration(projectPath);
      const { stdout, stderr } = await execAsync(config.command, {
        cwd: projectPath,
      });

      const testOutput = stdout + stderr;
      const analysis = await this.analyzeTestOutput(testOutput);

      return {
        success: true,
        data: {
          success: analysis.failedTests.length === 0,
          testOutput,
          failedTests: analysis.failedTests,
          passedTests: analysis.passedTests,
          suggestions: analysis.suggestions,
        },
        metadata: {
          timestamp: Date.now(),
          toolName: this.name,
        },
      };
    } catch (error) {
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
