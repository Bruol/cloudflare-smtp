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

interface CloudflareSocket {
	readable: ReadableStream<Uint8Array>;
	writable: WritableStream<Uint8Array>;
	startTls(): CloudflareSocket;
	close(): void;
}

type CloudflareConnect = (
	address: { hostname: string; port: number },
	options?: { secureTransport?: 'off' | 'on' | 'starttls' }
) => CloudflareSocket;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeHeader(value: string) {
	if (/^[\x00-\x7F]*$/.test(value)) return value;
	const bytes = encoder.encode(value);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return `=?UTF-8?B?${btoa(binary)}?=`;
}

function normalizeAddress(address: string) {
	return address.trim();
}

function sanitizeHeader(value: string) {
	return value.replace(/[\r\n]+/g, ' ').trim();
}

function sanitizeBody(value: string) {
	return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n\./g, '\n..');
}

function toBase64(value: string) {
	const bytes = encoder.encode(value);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function getRecipients(to: string | string[]) {
	const recipients = Array.isArray(to) ? to : [to];
	const normalized = recipients.map(normalizeAddress).filter(Boolean);
	if (normalized.length === 0) throw new Error('At least one recipient is required');
	return normalized;
}

function getPort(config: SmtpConfig) {
	if (config.port) return config.port;
	return config.secureTransport === 'tls' ? 465 : 587;
}

function getSecureTransport(config: SmtpConfig, port: number): Exclude<SecureTransport, 'auto'> {
	if (config.secureTransport && config.secureTransport !== 'auto') return config.secureTransport;
	if (port === 465) return 'tls';
	if (port === 587) return 'starttls';
	return 'off';
}

function getSocketSecureTransport(secureTransport: Exclude<SecureTransport, 'auto'>) {
	if (secureTransport === 'tls') return 'on';
	if (secureTransport === 'starttls') return 'starttls';
	return 'off';
}

function buildMessage(config: SmtpConfig, message: MailMessage) {
	const from = normalizeAddress(config.from);
	const recipients = getRecipients(config.to);
	const replyTo = message.replyTo ? sanitizeHeader(message.replyTo) : undefined;
	const subject = encodeHeader(sanitizeHeader(message.subject));
	const messageIdDomain = sanitizeHeader(config.messageIdDomain ?? config.host);
	const now = new Date();

	const headers = [
		`From: ${from}`,
		`To: ${recipients.join(', ')}`,
		replyTo ? `Reply-To: ${replyTo}` : undefined,
		`Subject: ${subject}`,
		`Date: ${now.toUTCString()}`,
		`Message-ID: <${crypto.randomUUID()}@${messageIdDomain}>`,
		'MIME-Version: 1.0',
		'Content-Type: text/plain; charset=UTF-8',
		'Content-Transfer-Encoding: 8bit'
	].filter(Boolean);

	return `${headers.join('\r\n')}\r\n\r\n${sanitizeBody(message.text)}\r\n`;
}

class SmtpSession {
	private socket: CloudflareSocket;
	private reader: ReadableStreamDefaultReader<Uint8Array>;
	private writer: WritableStreamDefaultWriter<Uint8Array>;
	private buffer = '';

	constructor(socket: CloudflareSocket) {
		this.socket = socket;
		this.reader = socket.readable.getReader();
		this.writer = socket.writable.getWriter();
	}

	async readResponse(expectedCodes: number[]) {
		while (true) {
			const { value, done } = await this.reader.read();
			if (done) throw new Error('SMTP connection closed unexpectedly');
			this.buffer += decoder.decode(value, { stream: true });

			if (!this.buffer.endsWith('\r\n')) continue;

			const lines = this.buffer.split('\r\n').filter(Boolean);
			const lastLine = lines.at(-1);
			const match = lastLine?.match(/^(\d{3})\s/);
			if (!match) continue;

			const code = Number(match[1]);
			const response = this.buffer.trimEnd();
			this.buffer = '';

			if (!expectedCodes.includes(code)) {
				throw new Error(`SMTP error ${code}: ${response}`);
			}

			return response;
		}
	}

	async command(command: string, expectedCodes: number[]) {
		await this.writer.write(encoder.encode(`${command}\r\n`));
		return this.readResponse(expectedCodes);
	}

	async writeData(data: string) {
		await this.writer.write(encoder.encode(data));
	}

	async startTls() {
		this.reader.releaseLock();
		this.writer.releaseLock();
		this.socket = this.socket.startTls();
		this.reader = this.socket.readable.getReader();
		this.writer = this.socket.writable.getWriter();
		this.buffer = '';
	}

	async close() {
		try {
			await this.command('QUIT', [221]);
		} finally {
			this.reader.releaseLock();
			this.writer.releaseLock();
			this.socket.close();
		}
	}
}

export async function sendMail(config: SmtpConfig, message: MailMessage) {
	const { connect } = (await import('cloudflare:sockets')) as { connect: CloudflareConnect };
	const port = getPort(config);
	const secureTransport = getSecureTransport(config, port);
	const socketSecureTransport = getSocketSecureTransport(secureTransport);
	const session = new SmtpSession(
		connect({ hostname: config.host, port }, { secureTransport: socketSecureTransport })
	);
	const from = normalizeAddress(config.from);
	const recipients = getRecipients(config.to);
	const heloName = sanitizeHeader(config.heloName ?? 'cloudflare-smtp.local');

	try {
		await session.readResponse([220]);
		await session.command(`EHLO ${heloName}`, [250]);

		if (secureTransport === 'starttls') {
			await session.command('STARTTLS', [220]);
			await session.startTls();
			await session.command(`EHLO ${heloName}`, [250]);
		}

		await session.command('AUTH LOGIN', [334]);
		await session.command(toBase64(config.username), [334]);
		await session.command(toBase64(config.password), [235]);
		await session.command(`MAIL FROM:<${from}>`, [250]);

		for (const recipient of recipients) {
			await session.command(`RCPT TO:<${recipient}>`, [250, 251]);
		}

		await session.command('DATA', [354]);
		await session.writeData(`${buildMessage(config, message)}\r\n.\r\n`);
		await session.readResponse([250]);
	} finally {
		await session.close();
	}
}
