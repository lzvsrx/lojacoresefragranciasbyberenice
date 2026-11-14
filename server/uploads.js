import sharp from "sharp";
import { inputError } from "./validation.js";

export function createUploadGate(maxActive = 4) {
  let active = 0;
  return (_req, res, next) => {
    if (active >= maxActive)
      return res.set("Retry-After", "2").status(429).json({
        error:
          "Muitos arquivos em processamento. Tente novamente em instantes.",
      });
    active++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        active--;
      }
    };
    res.once("finish", release);
    res.once("close", release);
    next();
  };
}

export async function sanitizeImage(file) {
  if (!file || !["image/png", "image/jpeg"].includes(file.mimetype))
    throw inputError("Envie uma imagem PNG ou JPEG");
  try {
    const signature =
      file.mimetype === "image/png"
        ? Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        : Buffer.from([0xff, 0xd8, 0xff]);
    // Reject other formats before invoking any of their decoder libraries.
    if (
      !Buffer.isBuffer(file.buffer) ||
      !file.buffer.subarray(0, signature.length).equals(signature)
    )
      throw new Error("Invalid image signature");
    const image = sharp(file.buffer, {
      limitInputPixels: 16 * 1024 * 1024,
      failOn: "warning",
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    if (
      !["png", "jpeg"].includes(metadata.format) ||
      !metadata.width ||
      !metadata.height ||
      (metadata.pages || 1) > 1 ||
      `image/${metadata.format}` !== file.mimetype
    )
      throw new Error("Invalid image");
    const output = await image
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: "inside",
        withoutEnlargement: true,
      })
      .toFormat(
        metadata.format,
        metadata.format === "jpeg" ? { quality: 90 } : {},
      )
      .toBuffer();
    if (output.length > 4 * 1024 * 1024) throw new Error("Image too large");
    return output;
  } catch {
    throw inputError(
      "Imagem inválida ou muito grande. Use PNG ou JPEG válido, até 16 milhões de pixels",
    );
  }
}

export const sanitizeUploadedImage = async (req, _res, next) => {
  try {
    if (req.file) req.file.buffer = await sanitizeImage(req.file);
    next();
  } catch (error) {
    next(error);
  }
};
