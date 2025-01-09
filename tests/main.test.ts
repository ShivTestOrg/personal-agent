import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { drop } from "@mswjs/data";
import { Octokit } from "@octokit/rest";
import { Logs } from "@ubiquity-dao/ubiquibot-logger";
import dotenv from "dotenv";
import manifest from "../manifest.json";
import { runPlugin } from "../src/plugin";
import { Env } from "../src/types";
import { Context } from "../src/types/context";
import { db } from "./__mocks__/db";
import { createComment, setupTests } from "./__mocks__/helpers";
import { server } from "./__mocks__/node";
import { STRINGS } from "./__mocks__/strings";
import { createAdapters } from "../src/adapters";

const SECONDS = 1000;

dotenv.config();
jest.requireActual("@octokit/rest");
const octokit = new Octokit();
const commentCreateEvent = "issue_comment.created";

beforeAll(() => {
  server.listen();
});
afterEach(() => {
  server.resetHandlers();
  jest.clearAllMocks();
});
afterAll(() => server.close());

describe("Personal Agent Plugin tests", () => {
  beforeEach(async () => {
    drop(db);
    await setupTests();
  });

  it("Should serve the manifest file", async () => {
    const worker = (await import("../src/worker")).default;
    const response = await worker.fetch(new Request("http://localhost/manifest"), {} as Env);
    const content = await response.json();
    expect(content).toEqual(manifest);
  });

  it(
    "log the values",
    async () => {
      const { context, errorSpy, okSpy, infoSpy, verboseSpy } = createContext();

      expect(context.eventName).toBe(commentCreateEvent);

      await runPlugin(context);

      expect(errorSpy).not.toHaveBeenCalled();
      expect(infoSpy).toHaveBeenNthCalledWith(1, `Comment received:`, {
        caller: STRINGS.CALLER_LOGS_ANON,
        personalAgentOwner: STRINGS.personalAgentOwner,
        owner: STRINGS.USER,
        comment: STRINGS.commentBody,
      });
      expect(okSpy).toHaveBeenNthCalledWith(1, `Comment created: Hello`);
      expect(verboseSpy).toHaveBeenNthCalledWith(1, "Exiting decideHandler");
    },
    10 * SECONDS
  );

  it("Should reply with err if wrong command", async () => {
    const { context, errorSpy, okSpy, infoSpy, verboseSpy } = createContext(`/@${STRINGS.personalAgentOwner} wrong command`);

    expect(context.eventName).toBe(commentCreateEvent);

    await runPlugin(context);

    expect(errorSpy).toHaveBeenCalledWith("Invalid command.", { body: "/@PersonalAgentOwner wrong command", caller: "_Logs.<anonymous>" });
    expect(infoSpy).toHaveBeenNthCalledWith(1, `Comment received:`, {
      caller: STRINGS.CALLER_LOGS_ANON,
      personalAgentOwner: STRINGS.personalAgentOwner,
      owner: STRINGS.USER,
      comment: `/@${STRINGS.personalAgentOwner} wrong command`,
    });
    expect(okSpy).toHaveBeenNthCalledWith(
      1,
      `Comment created: I could not understand your comment to give you a quick response. I will get back to you later.`
    );
    expect(verboseSpy).toHaveBeenNthCalledWith(1, "Exiting decideHandler");
  });
});

/**
 * The heart of each test. This function creates a context object with the necessary data for the plugin to run.
 *
 * So long as everything is defined correctly in the db (see `./__mocks__/helpers.ts: setupTests()`),
 * this function should be able to handle any event type and the conditions that come with it.
 *
 * Refactor according to your needs.
 */
function createContext(
  commentBody: string = STRINGS.commentBody,
  repoId: number = 1,
  payloadSenderId: number = 1,
  commentId: number = 1,
  issueOne: number = 1
) {
  const repo = db.repo.findFirst({ where: { id: { equals: repoId } } }) as unknown as Context["payload"]["repository"];
  const sender = db.users.findFirst({ where: { id: { equals: payloadSenderId } } }) as unknown as Context["payload"]["sender"];
  const issue1 = db.issue.findFirst({ where: { id: { equals: issueOne } } }) as unknown as Context["payload"]["issue"];

  createComment(commentBody, commentId); // create it first then pull it from the DB and feed it to _createContext
  const comment = db.issueComments.findFirst({ where: { id: { equals: commentId } } }) as unknown as Context["payload"]["comment"];

  const context = createContextInner(repo, sender, issue1, comment);
  const infoSpy = jest.spyOn(context.logger, "info");
  const errorSpy = jest.spyOn(context.logger, "error");
  const debugSpy = jest.spyOn(context.logger, "debug");
  const okSpy = jest.spyOn(context.logger, "ok");
  const verboseSpy = jest.spyOn(context.logger, "verbose");

  return {
    context,
    infoSpy,
    errorSpy,
    debugSpy,
    okSpy,
    verboseSpy,
    repo,
    issue1,
  };
}

/**
 * Creates the context object central to the plugin.
 *
 * This should represent the active `SupportedEvents` payload for any given event.
 */
function createContextInner(
  repo: Context["payload"]["repository"],
  sender: Context["payload"]["sender"],
  issue: Context["payload"]["issue"],
  comment: Context["payload"]["comment"]
): Context {
  return {
    eventName: "issue_comment.created",
    payload: {
      action: "created",
      sender: sender,
      repository: repo,
      issue: issue,
      comment: comment,
      installation: { id: 1 } as Context["payload"]["installation"],
      organization: { login: STRINGS.USER } as Context["payload"]["organization"],
    } as Context["payload"],
    logger: new Logs("debug"),
    config: {
      model: "o1-mini",
      openAiBaseUrl: undefined,
    },
    adapters: {} as ReturnType<typeof createAdapters>,
    env: {} as Env,
    octokit: octokit,
  };
}
