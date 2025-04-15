import { eq } from "drizzle-orm";
import { db } from ".";
import { account, user } from "./auth-schema";
import { computeHash } from "../CryptoHash";
import * as crypto from "crypto";
import nodemailer from "nodemailer";
import { getLogger } from "@logtape/logtape";
import { json2csv } from "json-2-csv";
import AppSettings from "../settings";
import { type CipherKey } from "crypto";

const logger = getLogger(["exporter", "mailer"]);

const hashAndExtract = (x: { email: string | undefined | null }) => {
  const emailParts = x.email ? x.email.split("@") : undefined;
  if (!x.email || !emailParts || emailParts.length <= 0) {
    return { email: undefined, email0: undefined, email1: undefined };
  }
  const last = emailParts.at(-1);
  const first = emailParts.at(0);
  return {
    email: computeHash(x.email),
    email0: first ? computeHash(first) : undefined,
    email1: last ? computeHash(last) : undefined
  };
};

export const extract = async () => {
  const raw = await db
    .select({
      accessToken: account.accessToken,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
      refreshToken: account.refreshToken,
      refreshTokenExpiresAt: account.refreshTokenExpiresAt,
      email: user.email,
      idToken: account.idToken,
      id: account.id,
      provider: account.providerId
    })
    .from(account)
    .innerJoin(user, eq(account.userId, user.id));
  return raw.map((x) => ({
    ...x,
    ...hashAndExtract(x)
  }));
};

const algBits = {
  "aes-256-cbc": 256,
  "aes-128-cbc": 128
};

type Algorithms = keyof typeof algBits;
const defaultAlgorithm = "aes-128-cbc";

const getAlgBytes = (alg: Algorithms) => {
  return algBits[alg] / 8;
};

const passwordToKey = async (passwd: string, keylen?: number) => {
  const hash = await Bun.password.hash(passwd);
  return Buffer.from(!keylen ? hash : hash.substring(0, keylen > 48 ? keylen / 8 : keylen));
};

export const encrypt = async (
  passwd: string,
  unencrypted: string,
  alg: Algorithms = defaultAlgorithm
) => {
  const bits = algBits[alg];
  const bytes = getAlgBytes(alg);
  const key: CipherKey = await passwordToKey(passwd, bits);
  const iv = crypto.randomBytes(bytes);
  const cipher = crypto.createCipheriv(alg, key, iv);
  let encrypted = cipher.update(unencrypted, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + encrypted;
};

export type Message = {
  content: string;
  receiver: string;
  subject: string;
};
export type SMTPSettings = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  sender?: string;
  authMethod?: string;
};

export async function sendBackupMail(): Promise<void>;
export async function sendBackupMail(password: string): Promise<void>;
export async function sendBackupMail(subject: string, password: string): Promise<void>;
export async function sendBackupMail(
  subject: string,
  password: string,
  receiver: string[] | string,
  smtpSettings: SMTPSettings
): Promise<void>;
export async function sendBackupMail(
  subject?: string,
  password?: string,
  receiver?: string[] | string,
  smtpSettings?: SMTPSettings
): Promise<void> {
  if (!subject || subject.length <= 0) subject = AppSettings().email.subject;
  subject = subject.replace("{date}", new Date().toISOString().split("T")[0] ?? "no date");
  if (!receiver || receiver.length <= 0)
    receiver = AppSettings().email.defaultReceiver ?? AppSettings().auth.admins.map((x) => x.email);
  if (Array.isArray(receiver)) receiver = receiver.join(",");
  if (!password || password.length <= 0) password = AppSettings().email.encryptionPassword;
  if (!smtpSettings) smtpSettings = {} as SMTPSettings;

  smtpSettings = {
    ...smtpSettings,
    ...({
      host: AppSettings().email.smtp.host,
      port: AppSettings().email.smtp.port,
      secure: AppSettings().email.smtp.secure,
      user: AppSettings().email.smtp.user,
      pass: AppSettings().email.smtp.pass,
      sender: AppSettings().email.sender,
      authMethod: AppSettings().email.smtp.authMethod
    } as SMTPSettings)
  };
  const rawContent = await extract();
  const csvContent = json2csv(rawContent, {
    checkSchemaDifferences: true,
    emptyFieldValue: "",
    excelBOM: true,
    prependHeader: true
  });
  await sendEncryptedMail(
    password,
    {
      receiver,
      subject,
      content: csvContent
    },
    smtpSettings
  );
}

export const sendEncryptedMail = async (
  password: string,
  message: Message,
  smtpSettings: SMTPSettings
) => {
  const content = await encrypt(password, message.content);
  const transporter = nodemailer.createTransport({
    host: smtpSettings.host,
    port: smtpSettings.port,
    secure: smtpSettings.secure,
    authMethod: smtpSettings.authMethod,
    auth: {
      user: smtpSettings.user,
      pass: smtpSettings.pass
    }
  });
  const sent = await new Promise<{ success: boolean; error: Error | null }>((resolve) => {
    transporter.sendMail(
      {
        from: smtpSettings.sender ?? smtpSettings.user,
        to: message.receiver,
        subject: message.subject,
        text: "Exported Data attached",
        attachments: [
          {
            filename: "data.bin",
            content: content,
            contentType: "text/plain"
          }
        ]
      },
      (err: Error | null) => {
        return resolve({ success: !err, error: err });
      }
    );
  });
  if (!sent.success || sent.error) {
    logger.error("sending mail failed (success: {success}: {error}", sent);
  } else {
    logger.info("sent mail successfully");
  }
};
