"use client";

import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type TextareaHTMLAttributes,
} from "react";

/**
 * Auto-growing textarea for the lookbook edit mode (issue #250): the
 * field expands with its content instead of scrolling, so a full
 * paragraph stays visible while editing.
 *
 * Issue #1543 (Modern Web Guidance — field sizing): the native
 * `field-sizing: content` declaration now grows the textarea with its
 * content, so it is applied as a progressive enhancement. Browsers that
 * do not support the property keep the JavaScript auto-grow fallback,
 * which is why the scrollHeight resize below only runs when
 * `CSS.supports("field-sizing", "content")` is false.
 *
 * Resizes on input and whenever the controlled `value` prop changes
 * (initial mount, generate-copy populate, autosave reconciliation).
 */

/**
 * Grows the textarea to fit its content.
 *
 * With native field sizing the browser does the work; without it the
 * scrollHeight fallback keeps the auto-grow behaviour (issue #1543).
 */
export function applyAutoGrow(el: HTMLTextAreaElement): void {
  // Progressive enhancement: where `field-sizing: content` is supported the
  // browser grows the field natively, so the JavaScript scrollHeight resize
  // below only runs where the property is unsupported.
  if (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("field-sizing", "content")
  ) {
    el.style.setProperty("field-sizing", "content");
    return;
  }
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

/**
 * Baseline styling for the progressive enhancement: native field sizing
 * plus the auto height/width the JS fallback used to apply inline.
 * `rows={1}` still gives the field its one-row minimum.
 */
const FIELD_SIZING_STYLE = {
  fieldSizing: "content",
  height: "auto",
  width: "100%",
} as CSSProperties;

export function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { style, onInput, ...rest } = props;

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    applyAutoGrow(el);
  };

  useLayoutEffect(resize, [props.value]);

  return (
    <textarea
      {...rest}
      ref={ref}
      rows={1}
      style={{ ...FIELD_SIZING_STYLE, ...style }}
      onInput={(e) => {
        resize();
        onInput?.(e);
      }}
    />
  );
}
