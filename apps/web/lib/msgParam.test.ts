import { expect, test } from 'vitest';
import { findMsg, parseMsgParam } from './msgParam';

test('a multi-topic search opens the message of the topic that was clicked, not the first with that partition:offset', () => {
  const rows = [
    { topic: 'orders', partition: 0, offset: 7 },
    { topic: 'payments', partition: 0, offset: 7 },
  ];
  expect(findMsg(rows, parseMsgParam('payments:0:7'))?.topic).toBe('payments');
  // an old partition:offset link (one topic per page) still works
  expect(findMsg(rows, parseMsgParam('0:7'))?.topic).toBe('orders');
  expect(parseMsgParam('nonsense')).toBeUndefined();
});
