export const EmbConstant = {
  NO_COMMAND: -1,
  STITCH: 0,
  JUMP: 1,
  TRIM: 2,
  STOP: 3,
  END: 4,
  COLOR_CHANGE: 5,
  SEQUIN_MODE: 6,
  SEQUIN_EJECT: 7,
  SLOW: 0xb,
  FAST: 0xc,

  STITCH_BREAK: 0xe0,

  SEQUENCE_BREAK: 0xe1,
  COLOR_BREAK: 0xe2,

  CONTINGENCY_SEQUIN_UTILIZE: 0xf5,
  CONTINGENCY_SEQUIN_JUMP: 0xf6,
  CONTINGENCY_SEQUIN_STITCH: 0xf7,
  CONTINGENCY_SEQUIN_REMOVE: 0xf8,

  COMMAND_MASK: 0xff,
  FLAGS_MASK: 0xff00,
} as const;

export type Command = (typeof EmbConstant)[keyof typeof EmbConstant];
