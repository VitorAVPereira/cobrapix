declare module 'sdk-node-apis-efi' {
  type EmptyParams = Record<string, never>;

  interface EfiPayOptions {
    sandbox: boolean;
    client_id: string;
    client_secret: string;
    partner_token?: string;
    certificate?: string;
    cert_base64?: boolean;
    validate_mtls?: boolean;
    validateMtls?: boolean;
    cache?: boolean;
    pix_cert?: string;
    pemKey?: string;
  }

  interface PixDueChargeBody {
    calendario: {
      dataDeVencimento: string;
      validadeAposVencimento?: number;
    };
    devedor: {
      logradouro: string;
      cidade: string;
      uf: string;
      cep: string;
      cpf?: string;
      cnpj?: string;
      nome: string;
    };
    valor: {
      original: string;
      desconto?: {
        modalidade: number;
        valorPerc?: string;
        descontoDataFixa?: Array<{
          data: string;
          valorPerc: string;
        }>;
      };
    };
    chave: string;
    solicitacaoPagador?: string;
  }

  interface PixDueChargeResponse {
    txid?: string;
    loc?: {
      id?: number;
      location?: string;
    };
    location?: string;
    pixCopiaECola?: string;
    status?: string;
  }

  interface PixSplitConfigBody {
    descricao: string;
    lancamento: {
      imediato: boolean;
    };
    split: {
      divisaoTarifa: string;
      minhaParte: {
        tipo: string;
        valor: string;
      };
      repasses: Array<{
        tipo: string;
        valor: string;
        favorecido: {
          conta: string;
        };
      }>;
    };
  }

  interface PixSplitConfigResponse {
    id?: string;
    splitConfigId?: string;
  }

  interface PixQrCodeResponse {
    qrcode?: string;
    imagemQrcode?: string;
  }

  interface CreateOneStepChargeBody {
    items: Array<{
      name: string;
      value: number;
      amount: number;
      marketplace?: {
        repasses: Array<{
          payee_code: string;
          percentage?: number;
          fixed?: number;
        }>;
      };
    }>;
    metadata?: {
      custom_id?: string;
      notification_url?: string;
    };
    payment: {
      banking_billet: {
        expire_at: string;
        discount?: {
          type: 'percentage' | 'currency';
          value: number;
        };
        conditional_discount?: {
          type: 'percentage' | 'currency';
          value: number;
          until_date: string;
        };
        configurations?: {
          days_to_write_off?: number;
          fine?: number;
          interest?:
            | number
            | {
                value: number;
                type: 'monthly' | 'daily';
              };
        };
        customer: {
          name: string;
          cpf?: string;
          email?: string;
          phone_number?: string;
          address: {
            street: string;
            number: string;
            neighborhood: string;
            zipcode: string;
            city: string;
            state: string;
          };
        };
      };
    };
  }

  interface CreateOneStepChargeResponse {
    code?: number;
    data?: {
      charge_id?: number;
      status?: string;
      barcode?: string;
      link?: string;
      billet_link?: string;
      pdf?: {
        charge?: string;
      };
      pix?: {
        qrcode?: string;
        qrcode_image?: string;
      };
    };
  }

  interface NotificationResponse {
    code?: number;
    data?: Array<{
      custom_id?: string | null;
      identifiers?: {
        charge_id?: number;
      };
      status?: {
        current?: string;
      };
    }>;
  }

  export default class EfiPay {
    constructor(options: EfiPayOptions);

    pixCreateDueCharge(
      params: { txid: string },
      body: PixDueChargeBody,
    ): Promise<PixDueChargeResponse>;

    pixDetailDueCharge(params: { txid: string }): Promise<PixDueChargeResponse>;

    pixGenerateQRCode(params: { id: number }): Promise<PixQrCodeResponse>;

    pixSplitConfig(
      params: EmptyParams,
      body: PixSplitConfigBody,
    ): Promise<PixSplitConfigResponse>;

    pixSplitLinkDueCharge(params: {
      txid: string;
      splitConfigId: string;
    }): Promise<void>;

    createOneStepCharge(
      params: EmptyParams,
      body: CreateOneStepChargeBody,
    ): Promise<CreateOneStepChargeResponse>;

    getNotification(params: { token: string }): Promise<NotificationResponse>;
  }
}
