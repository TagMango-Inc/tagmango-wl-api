import pino from "pino";

const workerLogger = pino({
  msgPrefix: "[ WORKER ] ",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});
export { workerLogger };
