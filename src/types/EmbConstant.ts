export enum EmbConstant {
  NO_COMMAND = -1,
  STITCH = 0,
  JUMP = 1,
  TRIM = 2,
  STOP = 3,
  END = 4,
  COLOR_CHANGE = 5,
  SEQUIN_MODE = 6,
  SEQUIN_EJECT = 7,
  SLOW = 0xb,
  FAST = 0xc,
  // Stitch with implied contingency.,
  SEW_TO = 0xb0,
  NEEDLE_AT = 0xb1,

  STITCH_BREAK = 0xe0,

  SEQUENCE_BREAK = 0xe1,
  COLOR_BREAK = 0xe2,
  TIE_ON = 0xe4,
  TIE_OFF = 0xe5,
  FRAME_EJECT = 0xe9,

  MATRIX_TRANSLATE = 0xc0,
  MATRIX_SCALE = 0xc1,
  MATRIX_ROTATE = 0xc2,
  MATRIX_RESET = 0xc3,

  OPTION_ENABLE_TIE_ON = 0xd1,
  OPTION_ENABLE_TIE_OFF = 0xd2,
  OPTION_DISABLE_TIE_ON = 0xd3,
  OPTION_DISABLE_TIE_OFF = 0xd4,
  OPTION_MAX_STITCH_LENGTH = 0xd5,
  OPTION_MAX_JUMP_LENGTH = 0xd6,
  OPTION_EXPLICIT_TRIM = 0xd7,
  OPTION_IMPLICIT_TRIM = 0xd8,

  CONTINGENCY_NONE = 0xf0,
  CONTINGENCY_JUMP_NEEDLE = 0xf1,
  CONTINGENCY_SEW_TO = 0xf2,

  CONTINGENCY_SEQUIN_UTILIZE = 0xf5,
  CONTINGENCY_SEQUIN_JUMP = 0xf6,
  CONTINGENCY_SEQUIN_STITCH = 0xf7,
  CONTINGENCY_SEQUIN_REMOVE = 0xf8,

  // Eventually the commands are supposed to be limited to 255 thereby,
  // allowing additional information like, color change to color in position n,
  // To be stored in the higher level bits.,
  COMMAND_MASK = 0xff,
}
