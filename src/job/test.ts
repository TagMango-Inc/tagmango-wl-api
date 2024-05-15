import pino from 'pino';
import { prettyFactory } from 'pino-pretty';

const pt = prettyFactory({
  colorize: true,
  customPrettifiers: {
    message: (msg: any) => {
      return `\u001b[31m${msg}\u001b[0m`; // Red text
    },
  },
});

const logger = pino({
  level: "debug",
  msgPrefix: "[ WORKER ] ",
  customLevels: {
    stdout: 35,
  },
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      // customPrettifiers: {}
      customPrettifiers: {
        // The argument for this function will be the same
        // string that's at the start of the log-line by default:
        time: (timestamp) => `🕰 ${timestamp}`,

        // The argument for the level-prettifier may vary depending
        // on if the levelKey option is used or not.
        // By default this will be the same numerics as the Pino default:
        level: (logLevel) => `LEVEL: ${logLevel}`,
        // level provides additional data in `extras`:
        // * label => derived level label string
        // * labelColorized => derived level label string with colorette colors applied based on customColors and whether colors are supported
        level: (logLevel, key, log, { label, labelColorized, colors }) =>
          `LEVEL: ${logLevel} LABEL: ${levelLabel} COLORIZED LABEL: ${labelColorized}`,

        // other prettifiers can be used for the other keys if needed, for example
        hostname: (hostname) => `MY HOST: ${hostname}`,
        pid: (pid) => pid,
        name: (name, key, log, { colors }) => `${colors.blue(name)}`,
        caller: (caller, key, log, { colors }) =>
          `${colors.greenBright(caller)}`,
        myCustomLogProp: (value, key, log, { colors }) =>
          `My Prop -> ${colors.bold(value)} <--`,
      },
    },
  },
});

const err = new Error("This is an error message");

logger.info(
  {
    username: "John Doe",
  },
  "[info] Hello, World!",
);
logger.warn("[warn] Hello, World!");
logger.error(err, "[error] Hello, World!");
logger.info("[info] Hello, World!");
logger.fatal("[fatal] Hello, World!");
logger.stdout("[stdout] Hello, World!");
logger.debug("[debug] Hello, World!");
