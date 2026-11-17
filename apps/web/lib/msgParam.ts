/** The drawer's ?msg= value: partition:offset on one topic's page, topic:partition:offset in a multi-topic search
 * (Kafka topic names can't contain ':'). */
export interface MsgRef {
  topic?: string;
  partition: number;
  offset: number;
}

export function parseMsgParam(s: string | null | undefined): MsgRef | undefined {
  const m = /^(?:([A-Za-z0-9._-]+):)?(\d+):(\d+)$/.exec(s ?? '');
  return m ? { topic: m[1], partition: Number(m[2]), offset: Number(m[3]) } : undefined;
}

export function findMsg<T extends { topic: string; partition: number; offset: number }>(
  list: readonly T[],
  ref: MsgRef | undefined,
): T | undefined {
  return ref
    ? list.find(
        (m) =>
          m.partition === ref.partition &&
          m.offset === ref.offset &&
          (!ref.topic || m.topic === ref.topic),
      )
    : undefined;
}
