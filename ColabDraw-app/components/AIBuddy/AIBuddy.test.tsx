import { render } from "@testing-library/react";

import { AIBuddy, type AIBuddyState } from "./AIBuddy";

const STATES: AIBuddyState[] = [
  "off",
  "idle",
  "listening",
  "thinking",
  "drawing",
  "done",
  "error",
];

describe("AIBuddy", () => {
  it.each(STATES)("renders state %s", (state) => {
    const { container, unmount } = render(
      <AIBuddy
        state={state}
        level={0.5}
        lookAt={{ x: 10, y: 10 }}
        title="buddy"
      />,
    );
    const el = container.querySelector(".ai-buddy")!;
    expect(el.getAttribute("data-state")).toBe(state);
    expect(el.getAttribute("role")).toBe("img");
    expect(el.querySelectorAll("svg")).toHaveLength(1);
    unmount();
  });
});
