import type { ReactNode } from 'react';

type Props = {
  title: string;
  body?: string;
  hint?: string;
  children?: ReactNode;
  confirmLabel?: string;
  onClose: () => void;
};

export function AlertModal({
  title,
  body,
  hint,
  children,
  confirmLabel = 'Entendido',
  onClose,
}: Props) {
  return (
    <div
      className="modal-backdrop"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="alert-modal-title"
      aria-describedby="alert-modal-body"
      onClick={onClose}
    >
      <div className="modal-card modal-card-wide" onClick={(e) => e.stopPropagation()}>
        <h2 id="alert-modal-title">{title}</h2>
        {body && (
          <p id="alert-modal-body">{body}</p>
        )}
        {children && (
          <div id={body ? undefined : 'alert-modal-body'} className="modal-body-rich">
            {children}
          </div>
        )}
        {hint && <p className="modal-hint">{hint}</p>}
        <button className="primary" type="button" style={{ width: '100%', padding: 12 }} onClick={onClose}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
