import { ChildProcessWithoutNullStreams, spawn } from "child_process";

const BASH_ERR_MSG = "No bash instance running.";

export class Terminal {
  private _process: ChildProcessWithoutNullStreams | null;
  private _onStdout: (data: string) => void;
  private _onStderr: (data: string) => void;
  private _onClose: (code: string) => void;

  constructor(onStdout: (data: string) => void, onStderr: (data: string) => void, onClose: (code: string) => void) {
    this._process = null;
    this.start();
    this._onStdout = onStdout;
    this._onStderr = onStderr;
    this._onClose = onClose;
  }

  // Method to start a bash instance
  start() {
    this._process = spawn("bash", [], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this._process.stdout.on("data", (data: string) => {
      this._onStdout(data);
    });

    this._process.stderr.on("data", (data: string) => {
      this._onStderr(data);
    });

    this._process.on("close", (code: string) => {
      this._onClose(code);
    });
  }

  // Method to run a command in the bash instance
  runCommand(command: string) {
    if (this._process) {
      this._process.stdin.write(`${command}\n`);
    } else {
      console.error(BASH_ERR_MSG);
    }
  }

  hasCommandCompleted() {
    if (this._process) {
      this._process.stdin.write("echo $?");
    } else {
      console.error(BASH_ERR_MSG);
    }
  }

  outputOnStdout() {
    if (this._process) {
      return this._process.stdout;
    } else {
      console.error(BASH_ERR_MSG);
    }
  }

  // Method to kill the bash instance
  kill() {
    if (this._process) {
      this._process.kill();
      this._process = null;
      console.log("Bash instance killed.");
    } else {
      console.error(BASH_ERR_MSG);
    }
  }
}

export function commonCallBack(id: string) {
  return (data: string) => {
    console.log(`Terminal ${id} stdout: ${data}`);
  };
}

export class TerminalManager {
  private _terminals: Map<string, Terminal>;
  constructor() {
    this._terminals = new Map();
    this.init();
  }

  init() {
    console.log("TerminalManager initialized");
  }

  // Method to create a new terminal instance
  createTerminal(id: string) {
    if (this._terminals.has(id)) {
      console.error(`Terminal with id ${id} already exists.`);
      return;
    }
    const terminal = new Terminal(commonCallBack(id), commonCallBack(id), commonCallBack(id));
    this._terminals.set(id, terminal);
    terminal.start();
    console.log(`Terminal with id ${id} created.`);
  }

  // Method to run a command in a specific terminal instance
  runCommandInTerminal(id: string, command: string) {
    const terminal = this._terminals.get(id);
    if (terminal) {
      terminal.runCommand(command);
    } else {
      console.error(`Terminal with id ${id} does not exist.`);
    }
  }

  // Method to kill a specific terminal instance
  killTerminal(id: string) {
    const terminal = this._terminals.get(id);
    if (terminal) {
      terminal.kill();
      this._terminals.delete(id);
      console.log(`Terminal with id ${id} killed.`);
    } else {
      console.error(`Terminal with id ${id} does not exist.`);
    }
  }
}
