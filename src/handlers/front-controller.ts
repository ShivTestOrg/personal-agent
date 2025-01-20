import { ExploreDir } from "../tools/explore-dir";
import { Context } from "../types";
import { detectPackageManager, installDependencies } from "../helpers/package-manager";
import { findEntryPoint } from "../helpers/entry-point";
import { detectTestConfiguration } from "../helpers/test-config";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function delegate(context: Context) {
  const { logger, payload } = context;
  const body = payload.comment.body;
  const repo = payload.repository.name;
  const owner = payload.repository.owner.login;
  const issueNumber = payload.issue.number;

  // Check if the comment is requesting to solve the issue
  if (body.toLowerCase().includes("solve this issue")) {
    // Initialize tools and completion system
    const explore = new ExploreDir(context);

    try {
      // First clone the repository
      const cloneResult = await explore.execute({
        command: "clone",
        repo,
        owner,
        issueNumber,
      });
      if (!cloneResult.success || !cloneResult.data) {
        logger.error(`Failed to clone repository: ${cloneResult.error}`);
        return;
      }

      // Get the current working directory after clone
      const workingDir = explore.getCurrentWorkingDir();

      // Setup project: detect and install package manager
      const packageManager = await detectPackageManager(workingDir);
      const installCommand = await installDependencies(workingDir);

      logger.info(`Installing dependencies using ${packageManager}...`);
      const { stdout: installOutput, stderr: installError } = await execAsync(installCommand, {
        cwd: workingDir,
      });

      // if (installError && installError.length > 0) {
      //   logger.debug(`Install error: ${installOutput}`);
      //   throw new Error(`Package installation failed: ${installError}`);
      logger.ok(`Install output: ${installOutput}`);
      logger.ok(`Install error: ${installError}`);
      // }
      logger.ok("Dependencies installed successfully");

      // Get the directory tree for context
      const treeResult = await explore.execute({ command: "tree" });
      const fileTree = treeResult.success && treeResult.data?.tree ? treeResult.data.tree : "";

      logger.ok(`Tree result: ${fileTree}`);

      // Find project entry point
      const entryPoint = await findEntryPoint(workingDir, logger);
      if (!entryPoint) {
        throw new Error("Could not find project entry point");
      }
      logger.ok(`Found project entry point: ${entryPoint}`);

      // Detect test configuration
      const testConfig = await detectTestConfiguration(workingDir);
      logger.ok(`Found test configuration: ${testConfig.runner}`);

      // Start the completion process with project info and issue description
      const issueDescription = payload.issue.body;
      const prompt = `Please help resolve this issue using Test-Driven Development (TDD):

Issue Description:
${issueDescription}

Project Information:
- Repository: ${owner}/${repo}
- Issue #${issueNumber}
- Package Manager: ${packageManager}
- Entry Point: ${entryPoint}
- Test Runner: ${testConfig.runner}
- Test Command: ${testConfig.command}
- Test Pattern: ${testConfig.testPattern}
${testConfig.configFile ? `- Test Config: ${testConfig.configFile}` : ""}

File Structure:
${fileTree}

Follow TDD Process:
1. First, read all files you require from the directory using the tree structure.
2. Generate a test that verifies the fix for the issue, following patterns.
3. Use the writeFile tool to write the test file to the appropriate location.
4. Use testRunner to run the test and verify it fails (as expected).
5. Write the solution using the writeFile tool.
6. Run the test again using testRunner to verify it passes.
7. Refactor if needed while keeping tests passing.`;

      // Get the solution with retries and verification
      const solution = await context.adapters.openai.completions.createCompletion(prompt, "deepseek/deepseek-r1", workingDir);

      if (!solution) {
        logger.error("No solution was generated");
        return;
      }

      const response = solution;
      if (!response) {
        logger.error("Empty response from completion");
        return;
      }

      // Log the final solution
      logger.ok("Solution generated successfully");
      logger.verbose(`Final solution: ${response}`);

      // Add a comment to the issue with the solution result
      await context.octokit.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: `I have generated and implemented a solution for this issue. Please review the pull request.`,
      });

      // Cleanup
      await explore.execute({ command: "kill" });
    } catch (error) {
      logger.error(`Error during completion: ${error instanceof Error ? error.message : "Unknown error"}`);

      // Add a comment about the failure
      await context.octokit.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: `I encountered an error while trying to solve this issue. Please check the logs for more details.
        \`\`\`plaintext
        Error: Failed to generate a solution for this issue.
        More Info: ${error instanceof Error ? error.message : "Unknown error"}
        \`\`\``,
      });
    }
  }

  logger.ok(`Comment processed: ${body}`);
  logger.verbose(`Exiting delegate`);
}
