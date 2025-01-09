import { Octokit } from "@octokit/rest";
import { LogLevel, Logs } from "@ubiquity-dao/ubiquibot-logger";
import { delegate } from "./handlers/front-controller";
import { Context, Env, PluginInputs } from "./types";
import { isIssueCommentEvent } from "./types/typeguards";
import { createAdapters } from "./adapters";
import OpenAI from "openai";

/**
 * The main plugin function. Split for easier testing.
 */
export async function runPlugin(context: Context) {
  const { logger, eventName } = context;

  if (isIssueCommentEvent(context)) {
    return await delegate(context);
  }

  logger.error(`Unsupported event: ${eventName}`);
}

/**
 * How a worker executes the plugin.
 */
export async function plugin(inputs: PluginInputs, env: Env) {
  const octokit = new Octokit({ auth: env.PERSONAL_AGENT_PAT_CLASSIC });
  const config = inputs.settings;

  const context: Context = {
    eventName: inputs.eventName,
    payload: inputs.eventPayload,
    config: config,
    octokit,
    env,
    logger: new Logs("info" as LogLevel),
    adapters: {} as ReturnType<typeof createAdapters>,
  };

  const openaiClient = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: env.OPENROUTER_API_KEY,
  });
  context.adapters = createAdapters(openaiClient, context);

  /**
   * NOTICE: Consider non-database storage solutions unless necessary
   *
   * Initialize storage adapters here. For example, to use Supabase:
   *
   * import { createClient } from "@supabase/supabase-js";
   *
   * const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
   * context.adapters = createAdapters(supabase, context);
   */

  await runPlugin(context);
}
