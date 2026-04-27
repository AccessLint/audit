import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  toWorkspaceRelative,
  pickAnnotatableSource,
  emitAnnotations,
} from "../src/annotations.js";
import type { SerializedViolation, SourceLocation } from "../src/types.js";

const warnMock = vi.fn();
vi.mock("@actions/core", () => ({
  warning: (...args: unknown[]) => warnMock(...args),
}));

beforeEach(() => {
  warnMock.mockClear();
});

describe("toWorkspaceRelative", () => {
  const ws = "/home/runner/work/repo/repo";

  it("strips file:// scheme and workspace prefix", () => {
    expect(
      toWorkspaceRelative(
        "file:///home/runner/work/repo/repo/src/Card.tsx",
        ws,
      ),
    ).toBe("src/Card.tsx");
  });

  it("handles workspace with trailing slash", () => {
    expect(
      toWorkspaceRelative("file:///home/runner/work/repo/repo/src/X.tsx", ws + "/"),
    ).toBe("src/X.tsx");
  });

  it("returns null for paths outside the workspace", () => {
    expect(
      toWorkspaceRelative("file:///opt/nodejs/lib/internal/whatever.js", ws),
    ).toBeNull();
  });

  it("returns null for malformed file URLs", () => {
    expect(toWorkspaceRelative("file://", ws)).toBeNull();
  });

  it("decodes URL-encoded path segments", () => {
    expect(
      toWorkspaceRelative(
        "file:///home/runner/work/repo/repo/src/My%20Component.tsx",
        ws,
      ),
    ).toBe("src/My Component.tsx");
  });

  it("passes already-relative paths through", () => {
    expect(toWorkspaceRelative("src/Card.tsx", ws)).toBe("src/Card.tsx");
  });
});

describe("pickAnnotatableSource", () => {
  const ws = "/home/runner/work/repo/repo";

  it("returns null for undefined or empty source", () => {
    expect(pickAnnotatableSource(undefined, ws)).toBeNull();
    expect(pickAnnotatableSource([], ws)).toBeNull();
  });

  it("picks the first source under the workspace", () => {
    const source: SourceLocation[] = [
      { file: "file:///opt/somewhere-else.js", line: 1, ownerDepth: 0 },
      {
        file: "file:///home/runner/work/repo/repo/src/Card.tsx",
        line: 42,
        column: 7,
        symbol: "Card",
        ownerDepth: 1,
      },
    ];
    const got = pickAnnotatableSource(source, ws);
    expect(got).toEqual({ file: "src/Card.tsx", line: 42, column: 7, symbol: "Card" });
  });

  it("returns null when no source is in the workspace", () => {
    const source: SourceLocation[] = [
      { file: "file:///opt/a.js", line: 1, ownerDepth: 0 },
      { file: "/usr/lib/b.js", line: 2, ownerDepth: 1 },
    ];
    expect(pickAnnotatableSource(source, ws)).toBeNull();
  });
});

describe("emitAnnotations", () => {
  const ws = "/home/runner/work/repo/repo";

  function makeViolation(source?: SourceLocation[]): SerializedViolation {
    return {
      ruleId: "text-alternatives/img-alt",
      selector: "img",
      html: "<img>",
      impact: "critical",
      message: "Missing alt.",
      source,
    };
  }

  it("emits a warning per annotatable violation", () => {
    const v1 = makeViolation([
      { file: "file:///home/runner/work/repo/repo/src/A.tsx", line: 10, ownerDepth: 0 },
    ]);
    const v2 = makeViolation([
      { file: "file:///home/runner/work/repo/repo/src/B.tsx", line: 20, column: 4, ownerDepth: 0 },
    ]);
    expect(emitAnnotations([v1, v2], ws)).toBe(2);
    expect(warnMock).toHaveBeenCalledTimes(2);
    expect(warnMock).toHaveBeenCalledWith("Missing alt.", {
      title: "text-alternatives/img-alt",
      file: "src/A.tsx",
      startLine: 10,
      startColumn: undefined,
    });
    expect(warnMock).toHaveBeenCalledWith("Missing alt.", {
      title: "text-alternatives/img-alt",
      file: "src/B.tsx",
      startLine: 20,
      startColumn: 4,
    });
  });

  it("skips violations with no usable source", () => {
    const v1 = makeViolation();
    const v2 = makeViolation([
      { file: "file:///opt/lib/x.js", line: 1, ownerDepth: 0 },
    ]);
    expect(emitAnnotations([v1, v2], ws)).toBe(0);
    expect(warnMock).not.toHaveBeenCalled();
  });
});
