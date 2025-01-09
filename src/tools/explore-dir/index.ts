import { commonCallBack, Terminal } from "../terminal";

export class ExploreDir {
  private _shellInterface: Terminal;

  constructor() {
    this._shellInterface = new Terminal(commonCallBack("stdout"), commonCallBack("stderr"), commonCallBack("exit"));
  }

  current_dir_tree(): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = "";
      let isCompleted = false;

      this._shellInterface.runCommand("ls -R");

      const stdout = this._shellInterface.outputOnStdout();
      if (!stdout) {
        reject(new Error("No bash instance running"));
        return;
      }
      stdout.on("data", (data: string) => {
        output += data.toString();
        if (isCompleted) {
          resolve(output);
        }
      });

      this._shellInterface.hasCommandCompleted();
      stdout.on("data", (data: string) => {
        const exitCode = parseInt(data.toString().trim());
        if (exitCode === 0) {
          isCompleted = true;
          if (output) {
            resolve(output);
          }
        } else {
          reject(new Error(`Command failed with exit code ${exitCode}`));
        }
      });
    });
  }

  clone_repo(repo: string, owner: string, issueNumber: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = "";
      let isCompleted = false;
      const tmpDir = `/tmp/repo-${owner}-${repo}-${issueNumber}`;

      this._shellInterface.runCommand(`git clone git@github.com:${owner}/${repo}.git ${tmpDir}`);

      const stdout = this._shellInterface.outputOnStdout();
      if (!stdout) {
        reject(new Error("No bash instance running"));
        return;
      }
      stdout.on("data", (data: string) => {
        output += data.toString();
        if (isCompleted) {
          resolve(output);
        }
      });

      this._shellInterface.hasCommandCompleted();
      stdout.on("data", (data: string) => {
        const exitCode = parseInt(data.toString().trim());
        if (exitCode === 0) {
          isCompleted = true;
          if (output) {
            resolve(output);
          }
        } else {
          reject(new Error(`Git clone failed with exit code ${exitCode}`));
        }
      });
    });
  }
}
