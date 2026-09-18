"use client";

import {
  useLayoutEffect,
  useRef,
  type TextareaHTMLAttributes,
} from "react";

/**
 * Auto-growing textarea for the lookbook edit mode (issue #250): the
 * field expands with its content instead of scrolling, so a full
 * paragraph stays visible while editing.
 *
 * Resizes on input and whenever the controlled `value` prop changes
 * (initial mount, generate-copy populate, autosave reconciliation).
 */
export function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  useLayoutEffect(resize, [props.value]);

  return <textarea ref={ref} onInput={resize} rows={1} {...props} />;
}
