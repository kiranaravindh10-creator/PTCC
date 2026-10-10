import { describe, expect, it } from "vitest";
import { buildBriefing, type BriefingTask } from "./briefing";

const today = "2026-10-08";
let n = 1000;
const task = (overrides: Partial<BriefingTask>): BriefingTask => ({
  kind: "general",
  status: "assigned",
  priority: "normal",
  dueDate: today,
  dueTime: null,
  number: ++n,
  ...overrides,
});

describe("buildBriefing", () => {
  it("puts work already in progress first", () => {
    const started = task({ status: "in_progress", dueTime: "15:00" });
    const early = task({ dueTime: "09:00" });
    expect(buildBriefing([early, started], today).nextUp).toBe(started);
  });

  it("puts overdue work before today's work", () => {
    const overdue = task({ dueDate: "2026-10-06" });
    const early = task({ dueTime: "09:00" });
    expect(buildBriefing([early, overdue], today).nextUp).toBe(overdue);
  });

  it("puts urgent work before earlier normal work", () => {
    const urgent = task({ priority: "urgent", dueTime: "16:00" });
    const early = task({ dueTime: "09:00" });
    expect(buildBriefing([early, urgent], today).nextUp).toBe(urgent);
  });

  it("orders by time, with untimed work after timed work", () => {
    const untimed = task({});
    const late = task({ dueTime: "16:00" });
    const early = task({ dueTime: "10:30" });
    const briefing = buildBriefing([untimed, late, early], today);
    expect(briefing.nextUp).toBe(early);
    expect(briefing.rest).toEqual([late, untimed]);
  });

  it("counts today's and overdue work by kind, and summarises the rest", () => {
    const briefing = buildBriefing(
      [
        task({ kind: "pickup" }),
        task({ kind: "pickup", dueDate: "2026-10-07" }),
        task({ kind: "delivery" }),
        task({ kind: "pickup", dueDate: "2026-10-09" }),
        task({ dueDate: null }),
      ],
      today,
    );
    expect(briefing.countsByKind).toEqual([
      { kind: "pickup", count: 2 },
      { kind: "delivery", count: 1 },
    ]);
    expect(briefing.overdue).toHaveLength(1);
    expect(briefing.upcomingCount).toBe(1);
    expect(briefing.unscheduledCount).toBe(1);
  });

  it("has nothing next when the day is clear", () => {
    expect(buildBriefing([task({ dueDate: "2026-10-10" })], today).nextUp).toBeNull();
  });
});
