"use client";

import { useEffect } from "react";

export default function ReviewPanel() {
  useEffect(() => {
    import("ui-ticket-panel").then(({ defineReviewPanel }) => {
      defineReviewPanel();
    });
  }, []);

  return (
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — review-panel is a native Web Component, not a React component
    <review-panel api-url="http://localhost:3200/api" />
  );
}
