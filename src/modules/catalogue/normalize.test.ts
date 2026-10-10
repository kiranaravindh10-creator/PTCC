import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compact, queryTokens, scopeLabel, splitDisciplineGroup } from "./normalize";
import { scopeStatus, scopeStatusText } from "./status";

const scopeFile = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../data/scope/ptcc-nabl-scope.json"), "utf8"),
) as { entries: { disciplineGroup: string }[] };

describe("splitDisciplineGroup", () => {
  it("recognises every Discipline/Group value in PTCC's scope file", () => {
    const values = [...new Set(scopeFile.entries.map((e) => e.disciplineGroup))];
    const unrecognised = values.filter((value) => splitDisciplineGroup(value) === null);
    expect(unrecognised).toEqual([]);
  });

  it("joins the discipline name wrapped across lines", () => {
    expect(splitDisciplineGroup("ELECTRO- TECHNICAL- DIRECT CURRENT (Source)")).toEqual({
      discipline: "ELECTRO-TECHNICAL",
      group: "DIRECT CURRENT (Source)",
    });
    expect(splitDisciplineGroup("FLUID FLOW- FLOW MEASURING DEVICES")).toEqual({
      discipline: "FLUID FLOW",
      group: "FLOW MEASURING DEVICES",
    });
  });

  it("refuses anything it does not recognise instead of guessing", () => {
    expect(splitDisciplineGroup("OPTICAL- PHOTOMETRY")).toBeNull();
    expect(splitDisciplineGroup("Pressure gauges")).toBeNull();
  });
});

describe("scopeLabel", () => {
  it("produces sentence-case labels for all groups, keeping abbreviations and units", () => {
    const groups = [...new Set(scopeFile.entries.map((e) => splitDisciplineGroup(e.disciplineGroup)!.group))].sort();
    const labels = Object.fromEntries(groups.map((g) => [g, scopeLabel(g)]));
    expect(labels).toMatchInlineSnapshot(`
      {
        "ACCELERATION AND SPEED": "Acceleration and speed",
        "ACOUSTICS": "Acoustics",
        "Alternating Current (< 1 GHz) (Measure)": "Alternating current (< 1 GHz) (measure)",
        "Alternating Current (< 1 GHz) (Source)": "Alternating current (< 1 GHz) (source)",
        "DENSITY AND VISCOSITY": "Density and viscosity",
        "DIMENSION (BASIC MEASURING INSTRUMENT, GAUGE ETC.)": "Dimension (basic measuring instrument, gauge etc.)",
        "DIMENSION (PRECISION INSTRUMENTS)": "Dimension (precision instruments)",
        "DIRECT CURRENT (Measure)": "Direct current (measure)",
        "DIRECT CURRENT (Source)": "Direct current (source)",
        "DUROMETER": "Durometer",
        "ELECTRICAL EQUIPMENT (Source)": "Electrical equipment (source)",
        "FLOW MEASURING DEVICES": "Flow measuring devices",
        "FORCE PROVING INSTRUMENTS": "Force proving instruments",
        "HARDNESS TESTING MACHINES": "Hardness testing machines",
        "MOBILE FORCE MEASURING SYSTEM": "Mobile force measuring system",
        "PRESSURE INDICATING DEVICES": "Pressure indicating devices",
        "SPECIFIC HEAT & HUMIDITY": "Specific heat & humidity",
        "TEMPERATURE": "Temperature",
        "TEMPERATURE SIMULATION (Measure)": "Temperature simulation (measure)",
        "TEMPERATURE SIMULATION (Source)": "Temperature simulation (source)",
        "TIME & FREQUENCY (Measure)": "Time & frequency (measure)",
        "TIME & FREQUENCY (Source)": "Time & frequency (source)",
        "TORQUE GENERATING DEVICES": "Torque generating devices",
        "TORQUE MEASURING DEVICES": "Torque measuring devices",
        "UTM, TENSION CREEP AND TORSION TESTING MACHINE": "UTM, tension creep and torsion testing machine",
        "VOLUME": "Volume",
        "WEIGHING SCALE AND BALANCE": "Weighing scale and balance",
        "WEIGHTS": "Weights",
      }
    `);
  });

  it("labels disciplines", () => {
    expect(scopeLabel("ELECTRO-TECHNICAL")).toBe("Electro-technical");
    expect(scopeLabel("FLUID FLOW")).toBe("Fluid flow");
  });
});

describe("search helpers", () => {
  it("is tolerant of words wrapped across lines in the source", () => {
    expect(compact("Annemometer(Veloci ty Of air)")).toContain("velocity");
  });

  it("tokenises queries and matches simple plurals", () => {
    expect(queryTokens("Pressure gauges")).toEqual([["pressure"], ["gauges", "gauge"]]);
    expect(queryTokens("a / b")).toEqual([]);
  });
});

describe("scopeStatus", () => {
  const bengaluru = { branchId: "b1", branchName: "Bengaluru", certificateNumber: "CC-2467", validUntil: "2028-12-05", isCurrent: true };
  const today = "2026-10-08";

  it("confirms scope only for the lead's own branch", () => {
    expect(scopeStatus(bengaluru, "b1", today)).toEqual({ kind: "in_scope", branchName: "Bengaluru" });
    expect(scopeStatus(bengaluru, "b2", today)).toEqual({ kind: "other_branch", entryBranchName: "Bengaluru" });
  });

  it("never claims accreditation for free-text requirements", () => {
    expect(scopeStatus(null, "b1", today)).toEqual({ kind: "not_confirmed" });
    expect(scopeStatusText({ kind: "not_confirmed" }).label).toBe("Scope not confirmed — verify with PTCC");
  });

  it("flags expired certificates, superseded rows, unconfirmed branches and leads without a branch", () => {
    expect(scopeStatus({ ...bengaluru, validUntil: "2026-01-01" }, "b1", today).kind).toBe("expired");
    expect(scopeStatus({ ...bengaluru, isCurrent: false }, "b1", today).kind).toBe("superseded");
    expect(scopeStatus({ ...bengaluru, branchId: null }, "b1", today).kind).toBe("branch_unverified");
    expect(scopeStatus(bengaluru, null, today).kind).toBe("branch_unknown");
  });
});
