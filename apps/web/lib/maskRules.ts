import { isValidMaskPath, type MaskRule } from '@ki/core';

/** Stored rules come from localStorage (hand-edited, an older version): keep only well-formed ones. */
export const validMaskRules = (rules: unknown[]): MaskRule[] =>
  rules.filter(
    (r): r is MaskRule =>
      !!r &&
      typeof r === 'object' &&
      ['id', 'name', 'topics', 'path'].every(
        (k) => typeof (r as Record<string, unknown>)[k] === 'string',
      ) &&
      isValidMaskPath((r as MaskRule).path),
  );
