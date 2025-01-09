import { Type as T } from "@sinclair/typebox";
import { StaticDecode } from "@sinclair/typebox";
import "dotenv/config";
import { StandardValidator } from "typebox-validators";

/**
 * Define sensitive environment variables here.
 *
 * These are fed into the worker/workflow as `env` and are
 * taken from either `dev.vars` or repository secrets.
 * They are used with `process.env` but are type-safe.
 */
export const envSchema = T.Object({
  PERSONAL_AGENT_PAT_CLASSIC: T.String(),
  OPENROUTER_API_KEY: T.String(),
  OPENAI_API_KEY: T.String(),
});

export const envValidator = new StandardValidator(envSchema);

export type Env = StaticDecode<typeof envSchema>;
