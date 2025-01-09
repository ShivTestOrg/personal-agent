import OpenAI from "openai";
import { Context } from "../../../types/context";
import { SuperOpenAi } from "./openai";

const sysMsg = `You are a capable AI assistant currently running on a GitHub bot. 
You are designed to assist with repository maintenance, code reviews, and issue resolution.
You have access to the following tools:
- read_file: Read contents of a file in the repository
- write_file: Write/update contents to a file
- terminal: Execute terminal commands
- test_code: Run tests for the codebase

Always be professional, concise, and follow these rules:
1. Before making changes, understand the context fully
2. When modifying code, ensure it maintains existing functionality
3. Follow the project's coding style and conventions
4. Document any significant changes
5. Consider edge cases and error handling`;

export class Completions extends SuperOpenAi {
  protected context: Context;
  protected model: string;
  protected maxTokens: number;

  constructor(client: OpenAI, context: Context) {
    super(client, context);
    this.context = context;
    this.model = "claude/sonnet";
    this.maxTokens = 100;
  }

  async createCompletion(prompt: string) {
    const res: OpenAI.Chat.Completions.ChatCompletion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content: [
            {
              type: "text",
              text: sysMsg,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: this.maxTokens,
      top_p: 0.5,
      frequency_penalty: 0,
      presence_penalty: 0,
      response_format: {
        type: "text",
      },
    });

    return res;
  }
}
