'use client';
import { isValidMaskPath, type MaskRule } from '@ki/core';
import { Button, Dialog, Select, TextField } from '@ki/ui';
import { useState } from 'react';

/** Masking rules (F-47): per topic pattern, a JSON path and an action. Stored per viewer. */
export function MaskingDialog({
  open,
  onClose,
  rules,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  rules: MaskRule[];
  onChange: (r: MaskRule[]) => void;
}) {
  const [draft, setDraft] = useState<MaskRule>({
    id: '',
    name: '',
    topics: '*',
    path: '$.',
    action: 'mask',
  });
  const pathOk = isValidMaskPath(draft.path);
  const valid = draft.name.trim() && draft.topics.trim() && pathOk;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Masking rules"
      description="Applied after decoding, in the table, drawer and exports. A display feature, not a security control."
      footer={
        <Button variant="primary" onClick={onClose}>
          Close masking rules
        </Button>
      }
    >
      <ul className="m-0 mb-4 flex list-none flex-col gap-2 p-0">
        {rules.length === 0 && (
          <li className="text-[13px] text-ink-muted">No rules. Messages show every field.</li>
        )}
        {rules.map((r) => (
          <li
            key={r.id}
            className="flex items-center gap-3 rounded-md border border-line-subtle px-3 py-2 text-[13px]"
          >
            <span className="grow">
              <span className="font-semibold">{r.name}</span>
              <span className="text-ink-muted">
                {' '}
                · {r.action} <code className="font-mono">{r.path}</code> on{' '}
                <code className="font-mono">{r.topics}</code>
              </span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange(rules.filter((x) => x.id !== r.id))}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) {
            onChange([...rules, { ...draft, id: `m-${Date.now()}` }]);
            setDraft({ id: '', name: '', topics: '*', path: '$.', action: 'mask' });
          }
        }}
      >
        <TextField
          label="Name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="cards on payments"
        />
        <TextField
          label="Topics"
          mono
          value={draft.topics}
          onChange={(e) => setDraft({ ...draft, topics: e.target.value })}
          hint="Glob, e.g. orders.* or *"
        />
        <TextField
          label="JSON path"
          mono
          value={draft.path}
          onChange={(e) => setDraft({ ...draft, path: e.target.value })}
          hint="$.email · $.card.number · $.items[*].sku · $.items[0] · $['a.b']"
          error={
            draft.path && !pathOk
              ? "Use $.field, $.a.b, [0], [*] or ['key']. This path can't be read."
              : undefined
          }
        />
        <Select
          label="Action"
          value={draft.action}
          onChange={(e) => setDraft({ ...draft, action: e.target.value as MaskRule['action'] })}
          options={[
            { value: 'mask', label: 'Mask (•••• masked)' },
            { value: 'replace', label: 'Replace with text' },
            { value: 'remove', label: 'Remove field' },
          ]}
        />
        {draft.action === 'replace' && (
          <TextField
            label="Replacement"
            value={draft.replacement ?? ''}
            onChange={(e) => setDraft({ ...draft, replacement: e.target.value })}
          />
        )}
        <div className="col-span-2">
          <Button type="submit" disabled={!valid}>
            Add rule
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
