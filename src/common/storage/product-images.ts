import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";

const allowedTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

export function productImageDirectory(uploadDir: string) {
  return resolve(uploadDir, "products");
}

export async function storeProductImage(input: { buffer: Buffer; uploadDir: string }) {
  const detected = await fileTypeFromBuffer(input.buffer);
  const extension = detected ? allowedTypes.get(detected.mime) : undefined;
  if (!detected || !extension) throw Object.assign(new Error("La imagen debe ser JPG, PNG o WebP."), { statusCode: 415 });
  const directory = productImageDirectory(input.uploadDir);
  await mkdir(directory, { recursive: true });
  const imageKey = `${randomUUID()}${extension}`;
  await writeFile(resolve(directory, imageKey), input.buffer, { flag: "wx" });
  return { imageKey, mimeType: detected.mime };
}

export async function readProductImage(uploadDir: string, imageKey: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(imageKey)) throw Object.assign(new Error("Imagen no encontrada."), { statusCode: 404 });
  const directory = productImageDirectory(uploadDir);
  const filePath = resolve(directory, imageKey);
  if (!filePath.startsWith(`${directory}${sep}`)) throw Object.assign(new Error("Imagen no encontrada."), { statusCode: 404 });
  const extension = extname(imageKey).toLowerCase();
  const mimeType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : null;
  if (!mimeType) throw Object.assign(new Error("Imagen no encontrada."), { statusCode: 404 });
  try { return { buffer: await readFile(filePath), mimeType }; }
  catch { throw Object.assign(new Error("Imagen no encontrada."), { statusCode: 404 }); }
}

export async function deleteUploadedProductImage(uploadDir: string, imageKey: string | null | undefined) {
  if (!imageKey || imageKey.startsWith("seed-") || !/^[a-zA-Z0-9._-]+$/.test(imageKey)) return;
  const directory = productImageDirectory(uploadDir);
  const filePath = resolve(directory, imageKey);
  if (!filePath.startsWith(`${directory}${sep}`)) return;
  try { await unlink(filePath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
