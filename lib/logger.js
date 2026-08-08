import pino from "pino";
import pretty from "pino-pretty";
import { LOG_LEVEL, IS_DEV } from "./env.js";

const transport = IS_DEV
  ? pretty({ colorize: true, translateTime: "SYS:HH:MM:ss" })
  : undefined;

export const logger = pino({ level: LOG_LEVEL }, transport);
