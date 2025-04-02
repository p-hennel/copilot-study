import { eq } from "drizzle-orm"
import { db } from "."
import { account, user } from "./auth-schema"
import { computeHash } from "../CryptoHash"
import * as crypto from "crypto"
import nodemailer from "nodemailer";

const hashAndExtract = (x: { email: string|undefined|null } ) => {
  const emailParts = x.email ? x.email.split("@") : undefined
  if (!x.email || !emailParts || emailParts.length <= 0) {
    return { email: undefined, email0: undefined, email1: undefined}
  }
  const last = emailParts[-1]
  const first = emailParts[0]
  return {
    email: computeHash(x.email),
    email0: first ? computeHash(first) : undefined,
    email1: last ? computeHash(last): undefined
  }
}

export const extract = async () => {
  const raw = await db.select({
    accessToken: account.accessToken,
    accessTokenExpiresAt: account.accessTokenExpiresAt,
    refreshToken: account.refreshToken,
    refreshTokenExpiresAt: account.refreshTokenExpiresAt,
    email: user.email,
    idToken: account.idToken,
    id: account.id,
    provider: account.providerId
  }).from(account).innerJoin(user, eq(account.userId, user.id))
  return raw.map(x => ({
    ...x,
    ...hashAndExtract(x)
  }))
}

export const encrypt = async (passwd: string, unencrypted: string) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes192", passwd, iv);
  let encrypted = cipher.update(unencrypted, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString('hex') + encrypted;
}

// https://java2s.com/example/nodejs/string/convert-hex-string-to-byte-array.html
function hexStringToByteArray(hexString: string): Uint8Array {
  if (hexString.length % 2 !== 0) {
      throw "Must have an even number of hex digits to convert to bytes";
  }
  const numBytes = hexString.length / 2;
  const byteArray = new Uint8Array(numBytes);
  for (let i=0; i<numBytes; i++) {
      byteArray[i] = parseInt(hexString.substr(i*2, 2), 16);
  }
  return byteArray;
}

export const decrypt = async (passwd: string, encrypted: string) => {
  // Pull the iv and encrypted data from the URL (first 32 bytes is the iv)
  const iv = encrypted.substr(0, 32);
  const ivArray = hexStringToByteArray(iv);
  // create a decipher object to decrypt the data
  const decipher = crypto.createDecipheriv("aes192", passwd, ivArray);
  // capture the rest of the string as our encrypted data
  const theData = encrypted.substr(32);
  let decrypted = decipher.update(theData, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted
}

export type Message = {
  content: string,
  receiver: string,
  subject: string,
}
export type SMTPSettings = {
  host: string,
  port: number,
  secure: boolean,
  user: string,
  pass: string,
  sender?: string
}

export const sendEncryptedMail = async (password: string, message: Message, smtpSettings: SMTPSettings) => {
  const content = await encrypt(password, message.content)
  const transporter = nodemailer.createTransport({
    host: smtpSettings.host,
    port: smtpSettings.port,
    secure: smtpSettings.secure,
    auth: {
        user: smtpSettings.user,
        pass: smtpSettings.pass
    },
  });
  const sent = new Promise((resolve, reject) => {
    await transporter.sendMail({
      from: smtpSettings.sender ?? smtpSettings.user,
      to: message.receiver,
      subject: message.subject,
      text: "Exported Data attached",
      attachments: [{
        filename: 'data.bin',
        content: content,
        contentType: 'text/plain'
      }]
    }, (err: Error, info) => {
      if (err) {
        return reject(err)
      }
      resolve()
    });
  })
  if (sent)
}