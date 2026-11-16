import { expect, test } from 'vitest';
import { fieldsOf } from './schemaFields';

test('a Protobuf or unparsable schema gives lines, not a crash', () => {
  const proto = {
    type: 'PROTOBUF',
    schema: 'syntax = "proto3";\nmessage A { string id = 1; }',
    version: 1,
    id: 1,
    subject: 's',
  };
  expect(fieldsOf(proto as never)).toHaveLength(2);
  expect(fieldsOf({ ...proto, type: 'AVRO', schema: 'not json' } as never)).toEqual([
    { name: '(source)', line: 'not json' },
  ]);
  expect(
    fieldsOf({
      ...proto,
      type: 'AVRO',
      schema: '{"type":"record","name":"R","fields":[{"name":"a","type":"int"}]}',
    } as never)[0]!.name,
  ).toBe('a');
});
