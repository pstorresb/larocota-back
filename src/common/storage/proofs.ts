import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileTypeFromBuffer } from "file-type";

const allowed = new Map([
  ["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"], ["application/pdf", ".pdf"],
]);

export async function storeProof(input: { buffer: Buffer; originalName: string; uploadDir: string }) {
  const detected = await fileTypeFromBuffer(input.buffer);
  const extension = detected ? allowed.get(detected.mime) : undefined;
  if (!detected || !extension) throw Object.assign(new Error("El comprobante debe ser JPG, PNG, WebP o PDF."), { statusCode: 415 });
  const directory = resolve(input.uploadDir, "payment-proofs");
  await mkdir(directory, { recursive: true });
  const storedName = `${randomUUID()}${extension}`;
  const path = resolve(directory, storedName);
  await writeFile(path, input.buffer, { flag: "wx" });
  return { storedName, path, mimeType: detected.mime, sizeBytes: input.buffer.length, sha256: createHash("sha256").update(input.buffer).digest("hex"), originalName: `${input.originalName.slice(0, 120).replace(/[\\/\0]/g, "_") || "comprobante"}${extname(input.originalName) ? "" : extension}` };
}
