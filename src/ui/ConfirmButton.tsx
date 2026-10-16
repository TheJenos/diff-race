import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  /** The button before it's pressed */
  children: ReactNode;
  /** Asked in its place once it's pressed, e.g. "Leave the race?" */
  question: ReactNode;
  /** The button that does it */
  yes: string;
  /** The button that backs out */
  no: string;
  onConfirm(): void;
  id?: string;
  className?: string;
  /** Class for the yes button (defaults to the solid danger style) */
  yesClassName?: string;
  disabled?: boolean;
  title?: string;
}

/**
 * A button for something that can't be undone (leaving, restarting): the first press swaps it for
 * a question with yes / no in the same spot, so a stray tap does nothing yet.
 */
export function ConfirmButton({ children, question, yes, no, onConfirm, id, className, yesClassName = 'danger solid', disabled, title }: Props) {
  const [asking, setAsking] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);

  // Backing out puts focus back on the button, so the keyboard doesn't lose its place.
  useEffect(() => {
    if (wasAsking.current && !asking) button.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  if (asking) {
    return (
      <span className="confirm" role="group">
        <span className="confirm-question">{question}</span>
        <button type="button" className={yesClassName} onClick={() => { setAsking(false); onConfirm(); }} autoFocus>{yes}</button>
        <button type="button" onClick={() => setAsking(false)}>{no}</button>
      </span>
    );
  }
  return (
    <button ref={button} id={id} type="button" className={className} disabled={disabled} title={title} onClick={() => setAsking(true)}>
      {children}
    </button>
  );
}
