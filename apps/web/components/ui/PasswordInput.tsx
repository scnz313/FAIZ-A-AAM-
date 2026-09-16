"use client";

import { forwardRef, useState } from "react";
import type { InputHTMLAttributes } from "react";

import styles from "./PasswordInput.module.css";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  revealLabel?: string;
};

const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { className = "", revealLabel = "password", ...props },
  ref,
) {
  const [visible, setVisible] = useState(false);
  const action = visible ? "Hide" : "Show";

  return (
    <div className={styles.wrap}>
      <input
        {...props}
        ref={ref}
        className={`${className} ${styles.input}`.trim()}
        type={visible ? "text" : "password"}
      />
      <button
        type="button"
        className={styles.toggle}
        aria-label={`${action} ${revealLabel}`}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
      >
        <span className="msym" aria-hidden="true">visibility</span>
        <span>{action}</span>
      </button>
    </div>
  );
});

export default PasswordInput;
