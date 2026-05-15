export const LOG_LEVELS = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
} as const;

export type LogLevel = keyof typeof LOG_LEVELS;

export const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
  silent: "Silent",
  error: "Error only",
  warn: "Warn",
  info: "Info (default)",
  debug: "Debug (verbose)",
};
