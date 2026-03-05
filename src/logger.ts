import chalk from "chalk";

export class Logger {
  constructor(private readonly debugEnabled: boolean) {}

  info(message: string): void {
    console.log(chalk.cyan("[fast-openclaw]"), message);
  }

  success(message: string): void {
    console.log(chalk.green("[fast-openclaw]"), message);
  }

  warn(message: string): void {
    console.warn(chalk.yellow("[fast-openclaw]"), message);
  }

  error(message: string): void {
    console.error(chalk.red("[fast-openclaw]"), message);
  }

  debug(message: string): void {
    if (this.debugEnabled) {
      console.log(chalk.gray("[fast-openclaw:debug]"), message);
    }
  }
}
