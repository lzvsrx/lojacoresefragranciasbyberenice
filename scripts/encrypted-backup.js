import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import path from "node:path";

const [action, input, output, keyFile] = process.argv.slice(2);
if (!["encrypt", "restore", "verify"].includes(action) || !input || !output || !keyFile)
  throw new Error("Uso: node scripts/encrypted-backup.js encrypt|restore|verify entrada saída chave-local");
const magic = Buffer.from("CORESE01");
const digest = (data) => createHash("sha256").update(data).digest("hex");
if (action !== "verify" && existsSync(output))
  throw new Error("O arquivo de saída já existe; escolha outro caminho.");

if (action === "encrypt") {
  if (existsSync(keyFile)) throw new Error("A chave já existe; escolha outro caminho.");
  const original = readFileSync(input);
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(magic);
  const encrypted = Buffer.concat([cipher.update(gzipSync(original)), cipher.final()]);
  mkdirSync(path.dirname(keyFile), { recursive: true });
  writeFileSync(keyFile, key.toString("hex"), { flag: "wx", mode: 0o600 });
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, Buffer.concat([magic, nonce, cipher.getAuthTag(), encrypted]), { flag: "wx" });
  console.log(JSON.stringify({ file: output, originalBytes: original.length, sha256: digest(original) }));
} else {
  const archive = readFileSync(input);
  if (archive.length < 36 || !archive.subarray(0, 8).equals(magic))
    throw new Error("Formato de backup inválido.");
  const keyText = readFileSync(keyFile, "utf8").trim();
  if (!/^[a-f0-9]{64}$/i.test(keyText)) throw new Error("Chave inválida.");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyText, "hex"), archive.subarray(8, 20));
  decipher.setAAD(magic);
  decipher.setAuthTag(archive.subarray(20, 36));
  const original = gunzipSync(Buffer.concat([decipher.update(archive.subarray(36)), decipher.final()]));
  if (action === "verify") {
    if (!original.equals(readFileSync(output))) throw new Error("Backup diferente do original.");
    console.log(`Verificado: cópia idêntica, SHA-256 ${digest(original)}`);
  } else {
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, original, { flag: "wx", mode: 0o600 });
    console.log(`Banco restaurado em ${output}`);
  }
}
