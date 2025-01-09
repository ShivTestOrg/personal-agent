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
    // Initialize LLM tools
    const explore = new ExploreDir();
    // Get the current directory tree
    let tree = await explore.current_dir_tree();
    // Log the tree
    logger.info(tree);
    // Clone the repository and get the file tree
    await explore.clone_repo(repo, owner, issueNumber);
    // Log the tree again
    tree = await explore.current_dir_tree();
    logger.info(tree);
  }

  logger.ok(`Comment processed: ${body}`);
  logger.verbose(`Exiting delegate`);
}
