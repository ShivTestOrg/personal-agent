import { WriteFile } from "../src/tools/write-file";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("WriteFile", () => {
  let writeFile: WriteFile;
  let testDir: string;

  beforeEach(() => {
    writeFile = new WriteFile();
    testDir = join(tmpdir(), `write-file-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("creates a new file with content", async () => {
    const filePath = join(testDir, "new-file.txt");
    const content = "Hello, World!";

    const result = await writeFile.execute({
      filename: filePath,
      content,
    });

    expect(result.success).toBe(true);
    expect(result.data?.bytesWritten).toBe(Buffer.from(content).length);
    expect(readFileSync(filePath, "utf8")).toBe(content);
    expect(result.data?.diffBlocksApplied).toBe(0);
  });

  it("creates nested directories if they don't exist", async () => {
    const filePath = join(testDir, "nested", "dirs", "new-file.txt");
    const content = "Hello from nested file!";

    const result = await writeFile.execute({
      filename: filePath,
      content,
    });

    expect(result.success).toBe(true);
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf8")).toBe(content);
  });

  it("applies diff blocks to existing file", async () => {
    const filePath = join(testDir, "existing-file.txt");
    const initialContent = "Line 1\nLine 2\nLine 3";
    writeFileSync(filePath, initialContent);

    const diffContent = `<<<<<<< SEARCH
Line 2
=======
Updated Line 2
>>>>>>> REPLACE`;

    const result = await writeFile.execute({
      filename: filePath,
      content: diffContent,
    });

    expect(result.success).toBe(true);
    expect(result.data?.diffBlocksApplied).toBe(1);
    expect(readFileSync(filePath, "utf8")).toBe("Line 1\nUpdated Line 2\nLine 3");
  });

  it("fails when applying diff blocks to non-existent file", async () => {
    const filePath = join(testDir, "non-existent.txt");
    const diffContent = `<<<<<<< SEARCH
some content
=======
new content
>>>>>>> REPLACE`;

    const result = await writeFile.execute({
      filename: filePath,
      content: diffContent,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Cannot apply diff blocks to non-existent file");
    expect(existsSync(filePath)).toBe(false);
  });

  it("fails when diff blocks are invalid", async () => {
    const filePath = join(testDir, "existing-file.txt");
    writeFileSync(filePath, "original content");

    const invalidDiff = `<<<<<<< SEARCH
non-matching content
=======
new content
>>>>>>> REPLACE`;

    const result = await writeFile.execute({
      filename: filePath,
      content: invalidDiff,
    });

    expect(result.success).toBe(false);
    expect(readFileSync(filePath, "utf8")).toBe("original content");
  });

  it("handles multiple diff blocks in order", async () => {
    const filePath = join(testDir, "multi-diff.txt");
    const initialContent = "First\nSecond\nThird\nFourth";
    writeFileSync(filePath, initialContent);

    const diffContent = `<<<<<<< SEARCH
Second
=======
Updated Second
>>>>>>> REPLACE

<<<<<<< SEARCH
Fourth
=======
Updated Fourth
>>>>>>> REPLACE`;

    const result = await writeFile.execute({
      filename: filePath,
      content: diffContent,
    });

    expect(result.success).toBe(true);
    expect(result.data?.diffBlocksApplied).toBe(2);
    expect(readFileSync(filePath, "utf8")).toBe("First\nUpdated Second\nThird\nUpdated Fourth");
  });
});
