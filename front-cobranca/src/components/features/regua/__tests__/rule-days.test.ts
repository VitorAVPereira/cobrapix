import type { CollectionRuleStep } from "@/lib/api-client";
import {
  dayLabel,
  dayMoment,
  scheduleProblem,
  toRuleDays,
  toStepInputs,
} from "../rule-days";

function step(overrides: Partial<CollectionRuleStep>): CollectionRuleStep {
  return {
    id: "step",
    profileId: "profile-1",
    stepOrder: 0,
    channel: "WHATSAPP",
    delayDays: 0,
    sendTimeStart: null,
    sendTimeEnd: null,
    isActive: true,
    scheduleDay: 0,
    attempted: false,
    customTemplates: [],
    ...overrides,
  };
}

describe("rule days", () => {
  it("groups the channels of a day and leaves the old Inicial steps out", () => {
    const days = toRuleDays([
      step({
        id: "inicial",
        stepOrder: 0,
        channel: "EMAIL",
        delayDays: -30,
        scheduleDay: -30,
      }),
      step({
        id: "d-2-email",
        stepOrder: 1,
        channel: "EMAIL",
        delayDays: 28,
        scheduleDay: -2,
      }),
      step({
        id: "d-2-wa",
        stepOrder: 2,
        delayDays: 0,
        scheduleDay: -2,
        attempted: true,
      }),
      step({ id: "d3", stepOrder: 3, delayDays: 5, scheduleDay: 3 }),
    ]);
    expect(
      days.map((row) => [row.day, Object.keys(row.channels).sort()]),
    ).toEqual([
      [-2, ["EMAIL", "WHATSAPP"]],
      [3, ["WHATSAPP"]],
    ]);
    expect(days[0]?.channels.WHATSAPP).toMatchObject({
      id: "d-2-wa",
      attempted: true,
    });
  });

  it("sends one step per channel with the delay since the previous step", () => {
    const days = toRuleDays([
      step({
        id: "d-2-email",
        stepOrder: 0,
        channel: "EMAIL",
        delayDays: -2,
        scheduleDay: -2,
      }),
      step({ id: "d-2-wa", stepOrder: 1, delayDays: 0, scheduleDay: -2 }),
    ]);
    days.push({
      key: "new",
      day: 4,
      channels: { WHATSAPP: { attempted: false, customTemplates: [] } },
      sendTimeStart: "10:00",
      sendTimeEnd: "12:00",
    });
    expect(toStepInputs(days)).toEqual([
      { id: "d-2-wa", stepOrder: 0, channel: "WHATSAPP", delayDays: -2 },
      { id: "d-2-email", stepOrder: 1, channel: "EMAIL", delayDays: 0 },
      {
        stepOrder: 2,
        channel: "WHATSAPP",
        delayDays: 6,
        sendTimeStart: "10:00",
        sendTimeEnd: "12:00",
      },
    ]);
  });

  it("explains what keeps a schedule from being saved", () => {
    const base = { key: "k", channels: {}, sendTimeStart: "", sendTimeEnd: "" };
    expect(scheduleProblem([{ ...base, day: 2 }])).toMatch(
      /Escolha WhatsApp, e-mail/,
    );
    expect(
      scheduleProblem([
        {
          ...base,
          day: 2,
          channels: { EMAIL: { attempted: false, customTemplates: [] } },
          sendTimeStart: "10:00",
        },
      ]),
    ).toMatch(/dois horários/);
    expect(
      scheduleProblem([
        {
          ...base,
          day: -30,
          channels: { EMAIL: { attempted: false, customTemplates: [] } },
        },
      ]),
    ).toMatch(/29 dias antes/);
  });

  it("names the day and the message it sends", () => {
    expect(dayLabel(-3)).toBe("3 dias antes");
    expect(dayLabel(0)).toBe("Dia do vencimento");
    expect(dayLabel(1)).toBe("1 dia após");
    expect(dayMoment(-1).label).toBe("Lembrete");
    expect(dayMoment(0).label).toBe("Vence hoje");
    expect(dayMoment(5)).toMatchObject({
      purpose: "FIRST_OVERDUE",
      label: "Atraso",
    });
  });
});
