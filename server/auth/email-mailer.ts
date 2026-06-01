import nodemailer from "nodemailer";

import type { EmailCodeMailer } from "./email-code-service.js";

type EmailDeliveryMode = "console" | "smtp";

export interface EmailMailerConfig {
  mode: EmailDeliveryMode;
  from: string;
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
  };
}

function readInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function readEmailMailerConfig(env: NodeJS.ProcessEnv = process.env): EmailMailerConfig {
  const mode = env.EMAIL_DELIVERY_MODE?.trim().toLowerCase() === "smtp" ? "smtp" : "console";
  const smtpPort = readInteger(env.SMTP_PORT, 587);
  const smtpSecure = readBoolean(env.SMTP_SECURE, smtpPort === 465);

  return {
    mode,
    from: env.SMTP_FROM?.trim() || "WhyBuddy <no-reply@whybuddy.local>",
    smtp: {
      host: env.SMTP_HOST?.trim() || "",
      port: smtpPort,
      secure: smtpSecure,
      user: env.SMTP_USER?.trim() || undefined,
      password: env.SMTP_PASSWORD || undefined,
    },
  };
}

export function createEmailCodeMailer(config: EmailMailerConfig): EmailCodeMailer {
  if (config.mode !== "smtp") {
    return {
      async sendLoginCode(input) {
        console.info(
          `[auth] Email login code for ${input.email}: ${input.code} (expires in ${input.expiresInMinutes} minutes)`,
        );
      },
    };
  }

  if (!config.smtp?.host) {
    throw new Error("EMAIL_DELIVERY_MODE=smtp requires SMTP_HOST.");
  }

  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user
      ? {
          user: config.smtp.user,
          pass: config.smtp.password ?? "",
        }
      : undefined,
  });

  return {
    async sendLoginCode(input) {
      await transporter.sendMail({
        from: config.from,
        to: input.email,
        subject: "WhyBuddy login code",
        text: [
          `Your WhyBuddy login code is ${input.code}.`,
          `It expires in ${input.expiresInMinutes} minutes.`,
          "If you did not request this code, you can ignore this email.",
        ].join("\n"),
        html: [
          "<p>Your WhyBuddy login code is:</p>",
          `<p style="font-size:24px;font-weight:700;letter-spacing:4px">${input.code}</p>`,
          `<p>It expires in ${input.expiresInMinutes} minutes.</p>`,
          "<p>If you did not request this code, you can ignore this email.</p>",
        ].join(""),
      });
    },
  };
}
