import { ExploreDir } from "../tools/explore-dir";
import { Context } from "../types";

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
      const workingDir = cloneResult.data.currentPath;

      // Get the directory tree for context
      const treeResult = await explore.execute({ command: "tree" });
      const fileTree = treeResult.success && treeResult.data?.tree ? treeResult.data.tree : "";

      // Start the completion process with the issue description and file tree
      const issueDescription = payload.issue.body;
      const prompt = `Please help resolve this issue:\n${issueDescription}\n\nRepository: ${owner}/${repo}\nIssue #${issueNumber}\n\nFile tree:\n${fileTree}`;

      // Get the solution with retries and verification
      const solution = await context.adapters.openai.completions.createCompletion(prompt, "anthropic/claude-3.5-sonnet", workingDir);

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
