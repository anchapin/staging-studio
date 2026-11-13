import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import GlobalStagingDirectivesBar, {
  handleAddLockKeyDown,
  isEnterToAddLock,
} from "@/components/canvas/global-staging-directives-bar";

/**
 * Issue #1543 (Modern Web Guidance — IME-safe Enter).
 *
 * The "Element name" input adds a lock when Enter is pressed. While an IME
 * composition is in flight the browser still fires `keydown` with
 * `key: "Enter"` (or the legacy `keyCode: 229` marker), so the handler has
 * to ignore those events — otherwise confirming a candidate word adds a
 * lock the user never asked for.
 *
 * The repo has no DOM test environment (vitest runs in `node` and no
 * jsdom/happy-dom dependency is available), so the component is driven
 * through a tiny hook dispatcher that renders the element tree directly.
 */

type AnyNode = any;

const internals = (
  React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: {
      H: unknown;
    };
  }
).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

/** Mounts a function component far enough to read its element tree. */
function mount<P>(Component: (props: P) => AnyNode, props: P) {
  const state: unknown[] = [];
  const refs: unknown[] = [];
  let hookIndex = 0;
  let tree: AnyNode = null;

  const render = () => {
    hookIndex = 0;
    internals.H = {
      useState: (initial: unknown) => {
        const i = hookIndex++;
        if (!(i in state)) {
          state[i] = typeof initial === "function" ? (initial as () => unknown)() : initial;
        }
        const setState = (next: unknown) => {
          state[i] = typeof next === "function" ? (next as (prev: unknown) => unknown)(state[i]) : next;
          render();
        };
        return [state[i], setState];
      },
      useRef: (initial: unknown) => {
        const i = hookIndex++;
        if (!(i in refs)) refs[i] = { current: initial };
        return refs[i];
      },
      useEffect: () => {},
      useLayoutEffect: () => {},
      useMemo: (factory: () => unknown) => factory(),
      useCallback: (fn: unknown) => fn,
    };
    try {
      tree = Component(props);
    } finally {
      internals.H = null;
    }
  };

  render();
  return { get tree() { return tree; } };
}

/** Depth-first search for the first element matching `predicate`. */
function findElement(node: AnyNode, predicate: (el: AnyNode) => boolean): AnyNode {
  if (node === null || node === undefined || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (predicate(node)) return node;
  return findElement(node.props?.children, predicate);
}

const BASE_PROPS = {
  aesthetic: "",
  onAestheticChange: () => {},
  lockedElements: [],
  onAddLock: () => {},
  onRemoveLock: () => {},
  realismValue: 50,
  onRealismChange: () => {},
  roomCount: 1,
  renderingCount: 0,
  gpuActive: false,
};

function openAddLockInput(props: typeof BASE_PROPS) {
  const mounted = mount(GlobalStagingDirectivesBar as never, props as never);
  const addButton = findElement(
    mounted.tree,
    (el) => el.type === "button" && el.props?.children?.includes?.("+ Add")
  );
  expect(addButton).toBeTruthy();
  addButton.props.onClick();
  const input = findElement(
    mounted.tree,
    (el) => el.type === "input" && el.props?.placeholder === "Element name"
  );
  expect(input).toBeTruthy();
  return { mounted, findInput: () => findElement(mounted.tree, (el) => el.type === "input" && el.props?.placeholder === "Element name") };
}

describe("Add-lock Enter is IME-safe (issue #1543)", () => {
  it("does not add a lock when Enter arrives during an IME composition", () => {
    const onAddLock = vi.fn();
    const { findInput } = openAddLockInput({ ...BASE_PROPS, onAddLock });

    findInput()!.props.onChange({ target: { value: "Wall" } });
    findInput()!.props.onKeyDown({ key: "Enter", isComposing: true, keyCode: 229 });

    expect(onAddLock).not.toHaveBeenCalled();
  });

  it("adds a lock on a normal Enter press", () => {
    const onAddLock = vi.fn();
    const { findInput } = openAddLockInput({ ...BASE_PROPS, onAddLock });

    findInput()!.props.onChange({ target: { value: "Wall" } });
    findInput()!.props.onKeyDown({ key: "Enter", isComposing: false, keyCode: 13 });

    expect(onAddLock).toHaveBeenCalledWith("Wall");
  });

  it("treats the legacy keyCode 229 marker as a composition event", () => {
    expect(isEnterToAddLock({ key: "Enter", keyCode: 229 })).toBe(false);
    expect(isEnterToAddLock({ key: "Enter", isComposing: true })).toBe(false);
    expect(isEnterToAddLock({ key: "Enter", isComposing: false, keyCode: 13 })).toBe(true);
    expect(isEnterToAddLock({ key: "a", isComposing: false, keyCode: 65 })).toBe(false);
  });

  it("exposes the same gate through the shared keydown helper", () => {
    const addLock = vi.fn();
    handleAddLockKeyDown({ key: "Enter", isComposing: true, keyCode: 229 }, addLock);
    expect(addLock).not.toHaveBeenCalled();

    handleAddLockKeyDown({ key: "Enter", isComposing: false, keyCode: 13 }, addLock);
    expect(addLock).toHaveBeenCalledTimes(1);
  });
});
