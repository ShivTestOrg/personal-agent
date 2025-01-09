import { Context } from "../types";
import { SuperOpenAi } from "./openai/helpers/openai";
import OpenAI from "openai";
import { Completions } from "./openai/helpers/completions";

export function createAdapters(openai: OpenAI, context: Context) {
  return {
    openai: {
      completions: new Completions(openai, context),
      super: new SuperOpenAi(openai, context),
    },
  };
}
