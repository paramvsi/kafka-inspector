import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cx } from './cx';

const control =
  'h-control-md w-full rounded-md border border-line bg-surface px-3 text-[13px] text-ink transition-colors duration-instant ease-standard placeholder:text-ink-muted focus:border-copper aria-[invalid=true]:border-crit disabled:opacity-45';

function Field({
  label,
  hint,
  error,
  id,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-[12px] font-medium text-ink-muted">
        {label}
      </label>
      {children}
      {error ? (
        <div id={`${id}-msg`} role="alert" className="text-[12px] text-crit-text">
          {error}
        </div>
      ) : hint ? (
        <div id={`${id}-msg`} className="text-[12px] text-ink-muted">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  hint,
  error,
  mono,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  mono?: boolean;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} id={id}>
      <input
        id={id}
        aria-invalid={!!error}
        aria-describedby={hint || error ? `${id}-msg` : undefined}
        className={cx(control, mono && 'font-mono text-[12px]', className)}
        {...rest}
      />
    </Field>
  );
}

export function TextArea({
  label,
  hint,
  error,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} id={id}>
      <textarea
        id={id}
        aria-invalid={!!error}
        aria-describedby={hint || error ? `${id}-msg` : undefined}
        className={cx(
          control,
          'h-auto min-h-[160px] py-2 font-mono text-[12px] leading-[18px]',
          className,
        )}
        {...rest}
      />
    </Field>
  );
}

export function Select({
  label,
  hint,
  error,
  options,
  className,
  hideLabel,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  hideLabel?: boolean;
}) {
  const id = useId();
  const select = (
    <select
      id={id}
      aria-label={hideLabel && typeof label === 'string' ? label : undefined}
      aria-invalid={!!error}
      aria-describedby={(!hideLabel && hint) || error ? `${id}-msg` : undefined}
      className={cx(control, 'cursor-pointer pr-8', className)}
      {...rest}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
  // hideLabel still shows an error (it must never disappear), linked to the control
  return hideLabel ? (
    error ? (
      <span className="flex flex-col gap-1">
        {select}
        <span id={`${id}-msg`} role="alert" className="text-[12px] text-crit-text">
          {error}
        </span>
      </span>
    ) : (
      select
    )
  ) : (
    <Field label={label} hint={hint} error={error} id={id}>
      {select}
    </Field>
  );
}

export function Checkbox({
  label,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label
      className={cx(
        'inline-flex cursor-pointer items-center gap-2 text-[13px] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-45',
        className,
      )}
    >
      <input
        type="checkbox"
        className="size-4 cursor-pointer accent-copper disabled:cursor-not-allowed"
        {...rest}
      />
      {label}
    </label>
  );
}

export function Switch({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-45">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative h-5 w-9 cursor-pointer rounded-full disabled:cursor-not-allowed border border-line transition-colors duration-fast ease-standard',
          checked ? 'bg-copper' : 'bg-surface-hover',
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            'absolute left-[2px] top-[2px] size-[14px] rounded-full bg-ink transition-transform duration-fast ease-standard motion-off:transition-none',
            checked && 'translate-x-4',
          )}
        />
      </button>
      {label}
    </label>
  );
}
