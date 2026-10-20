import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  SendNowFields,
  initialSendNow,
  sendNowPayload,
  sendNowProblem,
  type SendNowValue,
} from "../SendNowFields";

function Harness({ start }: { start: SendNowValue }) {
  const [value, setValue] = useState(start);
  return (
    <>
      <SendNowFields value={value} onChange={setValue} />
      <output data-testid="payload">
        {JSON.stringify(sendNowPayload(value))}
      </output>
    </>
  );
}

describe("SendNowFields", () => {
  it("starts from the company setting with WhatsApp checked", () => {
    expect(initialSendNow(undefined)).toEqual({
      sendNow: true,
      whatsapp: true,
      email: false,
    });
    expect(initialSendNow(false).sendNow).toBe(false);
  });

  it("sends nothing when the user declines and the chosen channels otherwise", () => {
    render(<Harness start={initialSendNow(true)} />);
    const payload = () => JSON.parse(screen.getByTestId("payload").textContent!);

    expect(payload()).toEqual({ send_now: true, send_channels: ["WHATSAPP"] });

    fireEvent.click(screen.getByRole("checkbox", { name: /E-mail/ }));
    expect(payload()).toEqual({
      send_now: true,
      send_channels: ["WHATSAPP", "EMAIL"],
    });

    fireEvent.click(
      screen.getByRole("checkbox", { name: /Enviar cobrança agora/ }),
    );
    expect(payload()).toEqual({ send_now: false });
    expect(screen.queryByRole("checkbox", { name: /WhatsApp/ })).toBeNull();
  });

  it("asks for a channel when sending now without any", () => {
    expect(
      sendNowProblem({ sendNow: true, whatsapp: false, email: false }),
    ).toMatch(/Escolha WhatsApp, e-mail/);
    expect(
      sendNowProblem({ sendNow: false, whatsapp: false, email: false }),
    ).toBeNull();
  });
});
