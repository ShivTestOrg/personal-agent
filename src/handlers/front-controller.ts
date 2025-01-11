import { CreatePr } from "../tools/create-pr";
import { ExploreDir } from "../tools/explore-dir";
import { ReadFile } from "../tools/read-file";
import { WriteFile } from "../tools/write-file";
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

      // // Get the directory tree for context
      // const treeResult = await explore.execute({ command: "tree" });
      // const fileTree = treeResult.success && treeResult.data?.tree ? treeResult.data.tree : "";

      // Initialize read and write tools
      const readFile = new ReadFile();
      const writeFile = new WriteFile();

      // Temporarily commenting out LLM completion code
      /*
      // Start the completion process with the issue description and file tree
      const issueDescription = payload.issue.body;
      const prompt = `Please help resolve this issue:\n${issueDescription}\n\nRepository: ${owner}/${repo}\nIssue #${issueNumber}\n\nFile tree:\n${fileTree}`;

      // Get the solution with retries and verification
      const solution = await context.adapters.openai.completions.createCompletion(prompt, "anthropic/claude-3.5-sonnet", workingDir);

      if (!solution) {
        logger.error("No solution was generated");
        return;
      }

      const response = solution.choices[0]?.message?.content;
      if (!response) {
        logger.error("Empty response from completion");
        return;
      }

      // Log the final solution
      logger.ok("Solution generated successfully");
      logger.verbose(`Final solution: ${response}`);
      */

      // Example: Read a file and write to another file
      const readResult = await readFile.execute({ filename: workingDir + "/README.md" });
      if (!readResult.success) {
        logger.error(`Failed to read file: ${readResult.error} + ${workingDir}`);
        return;
      }

      console.log(JSON.stringify(readResult, null, 2));
      logger.info(`Read content: ${readResult.data?.content}`);

      const writeResult = await writeFile.execute({
        filename: workingDir + "/output.txt",
        content: readResult.data?.content || "",
      });
      if (!writeResult.success) {
        logger.error(`Failed to write file: ${writeResult.error}`);
        return;
      }

      logger.ok("File operations completed successfully");
      logger.verbose("Files processed: README.md -> output.txt");

      const prTool = new CreatePr(context, workingDir);
      await prTool.execute({
        title: "Solved issue",
        body: "I have solved this issue. Please review the changes.",
      });

      // Add a comment to the issue with the file operation result
      await context.octokit.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: `File operations completed successfully. Processed README.md -> output.txt`,
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
        body: "I encountered an error while trying to solve this issue. Please check the logs for more details.",
      });
    }
  }

  logger.ok(`Comment processed: ${body}`);
  logger.verbose(`Exiting delegate`);
}
