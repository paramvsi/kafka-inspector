import { expect, test } from 'vitest';
import { align } from './schemaDiff';

const f = (name: string) => ({ name, line: name });

test('lines the newer version added past the older one are shown (Protobuf / source rows, no field changes)', () => {
  const rows = align([f('1'), f('2')], [f('1'), f('2'), f('3'), f('4')], []);
  expect(rows.map((r) => r.right?.name)).toEqual(['1', '2', '3', '4']);
  expect(rows.filter((r) => r.kind === 'added').map((r) => r.right!.name)).toEqual(['3', '4']);
});

test('a field moved earlier plus an added one shows each right-hand field once', () => {
  const rows = align(
    [f('x'), f('y'), f('z')],
    [f('z'), f('n'), f('x'), f('y')],
    [{ field: 'n', change: 'added' } as never],
  );
  const right = rows.map((r) => r.right?.name).filter(Boolean);
  expect(right.sort()).toEqual(['n', 'x', 'y', 'z']);
});
