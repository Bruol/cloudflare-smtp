export type SecureTransport = 'auto' | 'off' | 'tls' | 'starttls';
export interface SmtpConfig {
    host: string;
    port?: number;
    username: string;
    password: string;
    from: string;
    to: string | string[];
    secureTransport?: SecureTransport;
    heloName?: string;
    messageIdDomain?: string;
}
export interface MailMessage {
    subject: string;
    replyTo?: string;
    text: string;
}
export declare function sendMail(config: SmtpConfig, message: MailMessage): Promise<void>;
