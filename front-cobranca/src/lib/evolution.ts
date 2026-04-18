/**
 * Cliente para a Evolution API (WhatsApp BYOD via Docker local).
 * Todas as chamadas passam pela API key global configurada em EVOLUTION_API_KEY.
 */

const getBaseUrl = () =>
  process.env.EVOLUTION_API_URL || "http://localhost:8080";

const getApiKey = () => {
  const key = process.env.EVOLUTION_API_KEY;
  if (!key) {
    throw new Error(
      "EVOLUTION_API_KEY não está definida. Configure no arquivo .env."
    );
  }
  return key;
};

async function evolutionFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${getBaseUrl()}/api/v1${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      apikey: getApiKey(),
      ...options.headers,
    },
  });

  return res;
}

// ─── Tipos de resposta ────────────────────────────────────────

export interface CreateInstanceResponse {
  instance: {
    instanceName: string;
    instanceId: string;
    status: string;
  };
  hash: {
    apikey: string;
  };
}

export interface ConnectInstanceResponse {
  pairingCode?: string;
  code: string; // base64 QR code PNG
  count: number;
}

export interface ConnectionStateResponse {
  instance: {
    state: "open" | "close" | "connecting";
  };
}

// ─── Funções públicas ─────────────────────────────────────────

export async function createInstance(
  instanceName: string
): Promise<CreateInstanceResponse> {
  // Monta a URL do webhook para a Evolution API enviar eventos
  const webhookUrl = process.env.EVOLUTION_WEBHOOK_URL
    || `${process.env.NEXT_PUBLIC_APP_URL || "http://host.docker.internal:3000"}/api/webhooks/evolution`;

  const res = await evolutionFetch("/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      webhook: {
        url: webhookUrl,
        webhook_by_events: false,
        webhook_base64: false,
        events: ["CONNECTION_UPDATE"],
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Evolution API: falha ao criar instância (${res.status}): ${body}`
    );
  }

  return res.json();
}

export async function connectInstance(
  instanceName: string
): Promise<ConnectInstanceResponse> {
  const res = await evolutionFetch(`/instance/connect/${instanceName}`);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Evolution API: falha ao obter QR code (${res.status}): ${body}`
    );
  }

  return res.json();
}

export async function getConnectionState(
  instanceName: string
): Promise<ConnectionStateResponse> {
  const res = await evolutionFetch(
    `/instance/connectionState/${instanceName}`
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Evolution API: falha ao consultar status (${res.status}): ${body}`
    );
  }

  return res.json();
}

export interface SendTextResponse {
  key: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
  };
  messageTimestamp: string;
  status: string;
}

export async function sendTextMessage(
  instanceName: string,
  phoneNumber: string,
  text: string
): Promise<SendTextResponse> {
  const res = await evolutionFetch(`/message/sendText/${instanceName}`, {
    method: "POST",
    body: JSON.stringify({ number: phoneNumber, text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Evolution API: falha ao enviar mensagem (${res.status}): ${body}`
    );
  }

  return res.json();
}

export async function logoutInstance(instanceName: string): Promise<void> {
  const res = await evolutionFetch(`/instance/logout/${instanceName}`, {
    method: "DELETE",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Evolution API: falha ao desconectar (${res.status}): ${body}`
    );
  }
}
