import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CheckoutAssetKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const CHECKOUT_ASSET_MAX_BYTES = 1024 * 1024;

export interface UploadedImageFile {
  buffer: Buffer;
  size: number;
}

/**
 * The type comes from the file's first bytes, never from its name or the
 * browser. SVG is refused on purpose: it can carry scripts.
 */
export function detectImageType(data: Buffer): string | null {
  if (
    data.length >= 8 &&
    data
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  )
    return 'image/jpeg';
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  return null;
}

@Injectable()
export class CheckoutAssetsService {
  constructor(private readonly prisma: PrismaService) {}

  async upload(
    companyId: string,
    kind: CheckoutAssetKind,
    file: UploadedImageFile | undefined,
  ) {
    if (!file?.buffer?.length) throw this.invalid('Envie uma imagem.');
    if (file.size > CHECKOUT_ASSET_MAX_BYTES)
      throw this.invalid('A imagem pode ter no máximo 1 MB.');
    const contentType = detectImageType(file.buffer);
    if (!contentType) throw this.invalid('Use uma imagem PNG, JPEG ou WebP.');
    const asset = await this.prisma.checkoutAsset.create({
      data: {
        companyId,
        kind,
        contentType,
        sizeBytes: file.buffer.length,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        data: new Uint8Array(file.buffer),
      },
      select: { id: true, kind: true, contentType: true, sizeBytes: true },
    });
    return { ...asset, url: `/checkout/public/assets/${asset.id}` };
  }

  /** Images are public by design: they appear on the payment page. */
  async read(id: string) {
    const asset = await this.prisma.checkoutAsset.findUnique({
      where: { id },
      select: { contentType: true, data: true },
    });
    if (!asset) throw new NotFoundException('Imagem não encontrada.');
    return { contentType: asset.contentType, data: Buffer.from(asset.data) };
  }

  /** An asset id chosen by the seller must be theirs and of the expected kind. */
  async assertOwned(
    client: Prisma.TransactionClient | PrismaService,
    companyId: string,
    id: string | null | undefined,
    kind: CheckoutAssetKind,
  ): Promise<void> {
    if (!id) return;
    const asset = await client.checkoutAsset.findFirst({
      where: { id, companyId, kind },
      select: { id: true },
    });
    if (!asset) throw new NotFoundException('Imagem não encontrada.');
  }

  private invalid(message: string): BadRequestException {
    return new BadRequestException({ code: 'CHECKOUT_INVALID_IMAGE', message });
  }
}
