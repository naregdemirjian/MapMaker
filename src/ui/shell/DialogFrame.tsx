// A window of settings (D209): shown over everything as a dialog, or, inside a group of Properties, as part of it.
import { createContext, useContext } from 'react';

/** Set by a group of Properties that shows a dialog's contents in place. */
export const InlineDialog = createContext(false);

export function DialogFrame({ title, label, testId, wide, className, onClose, children }: { title: React.ReactNode; label?: string; testId?: string; wide?: boolean; className?: string; onClose: () => void; children: React.ReactNode }) {
  const inline = useContext(InlineDialog);
  if (inline) return <div className={`inline-dialog ${className ?? ''}`} data-testid={testId ? `${testId}-inline` : undefined}>{children}</div>;
  return (
    <div className="modal-back" onPointerDown={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''} ${className ?? ''}`} role="dialog" aria-label={label ?? (typeof title === 'string' ? title : undefined)} data-testid={testId}>
        <div className="modal-head"><h2>{title}</h2><button className="close" onClick={onClose} aria-label="Close">×</button></div>
        {children}
      </div>
    </div>
  );
}
