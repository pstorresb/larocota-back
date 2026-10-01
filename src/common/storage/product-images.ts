import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const safeKey = /^[a-zA-Z0-9._-]+$/;
const CARD_SUFFIX = "-card.webp";

export function productImageDirectory(uploadDir: string) {
  return resolve(uploadDir, "products");
}

/** Key of the small variant for an uploaded image; seed and legacy files have none. */
export function cardImageKey(imageKey: string) {
  if (imageKey.startsWith("seed-") || !imageKey.endsWith(".webp") || imageKey.endsWith(CARD_SUFFIX)) return null;
  return imageKey.replace(/\.webp$/, CARD_SUFFIX);
}

/** Public paths for a stored image. The frontend prepends the API base URL. */
export function productImageUrls(imageKey: string | null | undefined) {
  if (!imageKey) return { imageUrl: null, imageCardUrl: null };
  const full = `/media/products/${encodeURIComponent(imageKey)}`;
  const card = cardImageKey(imageKey);
  return { imageUrl: full, imageCardUrl: card ? `/media/products/${encodeURIComponent(card)}` : full };
}

/**
 * Validates the upload by its bytes, then stores two WebP variants with EXIF rotation applied and
 * metadata stripped: a large one (1200 px) for the product modal and a card one (480 px) for the menu.
 */
export async function storeProductImage(input: { buffer: Buffer; uploadDir: string }) {
  const detected = await fileTypeFromBuffer(input.buffer);
  if (!detected || !allowedTypes.has(detected.mime)) throw Object.assign(new Error("La imagen debe ser JPG, PNG o WebP."), { statusCode: 415 });
  let large: Buffer;
  let card: Buffer;
  try {
    const source = sharp(input.buffer, { failOn: "error" }).rotate();
    large = await source.clone().resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    card = await source.clone().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  } catch {
    throw Object.assign(new Error("No pudimos leer la imagen. Prueba con otro archivo."), { statusCode: 415 });
  }
  const directory = productImageDirectory(input.uploadDir);
  await mkdir(directory, { recursive: true });
  const imageKey = `${randomUUID()}.webp`;
  await writeFile(resolve(directory, imageKey), large, { flag: "wx" });
  await writeFile(resolve(directory, imageKey.replace(/\.webp$/, CARD_SUFFIX)), card, { flag: "wx" });
  return { imageKey, mimeType: "image/webp" };
}

export async function readProductImage(uploadDir: string, imageKey: string) {
  if (!safeKey.test(imageKey)) throw Object.assign(new Error("Imagen no encontrada."), { statusCode: 404 });
  const directory = productImageDirectory(uploadDir);
  const filePath = resolve(directory, imageKey);
  if (!filePath.startsWith(`${directory}${sep}`)) throw Object.assign(new Error("Imagen no encontrada."), { statusCode: 404 });
  const extension = extname(imageKey).toLowerCase();
  const mimeType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : null;
  if (!mimeType) throw Object.assign(new Error("Imagen no encontrada."), { statusCode: 404 });
  try { return { buffer: await readFile(filePath), mimeType }; }
  catch { throw Object.assign(new Error("Imagen no encontrada."), { statusCode: 404 }); }
}

async function removeFile(directory: string, key: string) {
  const filePath = resolve(directory, key);
  if (!filePath.startsWith(`${directory}${sep}`)) return;
  try { await unlink(filePath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

/** Deletes an uploaded image and its card variant. Seed images are shared assets and are kept. */
export async function deleteUploadedProductImage(uploadDir: string, imageKey: string | null | undefined) {
  if (!imageKey || imageKey.startsWith("seed-") || !safeKey.test(imageKey)) return;
  const directory = productImageDirectory(uploadDir);
  await removeFile(directory, imageKey);
  const card = cardImageKey(imageKey);
  if (card) await removeFile(directory, card);
}
